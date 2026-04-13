// processor-kernel.ts — Pure DSP logic, state machine, all filters
// NO AudioWorklet or platform dependencies. Fully testable.

import {
	type BlockParameters,
	type BlockReturnState,
	type BufferRangeWrite,
	type ClipProcessorOptions,
	type LoopMode,
	State,
	type StreamBufferSpan,
	type StreamBufferState,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SAMPLE_BLOCK_SIZE = 128;

/** Maximum number of non-sequential (seek-origin) spans tracked in the worklet.
 *  An O(4) scan replaces the previous dynamic array sort. */
const MAX_SEEK_SPANS = 4;

function createStreamBufferState(
	buffer: Float32Array[] = [],
): StreamBufferState {
	const totalLength = buffer[0]?.length ?? 0;
	const hasBuffer = totalLength > 0;
	return {
		totalLength: hasBuffer ? totalLength : null,
		committedLength: hasBuffer ? totalLength : 0,
		endRequested: hasBuffer,
		streamEnded: hasBuffer,
		streaming: false,
		streamingActive: false,
		maxWrittenSample: hasBuffer ? totalLength : 0,
		seekSpans: [],
		lowWaterThreshold: SAMPLE_BLOCK_SIZE * 4,
		lowWaterNotified: false,
		lastUnderrunSample: null,
		underrunActive: false,
		underrunRecoverySamples: 256,
		underrunRecoveryPosition: 256, // Start at max = no recovery needed
	};
}

function getBufferLength(buffer: Float32Array[]): number {
	return buffer[0]?.length ?? 0;
}

function getLogicalBufferLength(
	properties: Required<ClipProcessorOptions>,
): number {
	return (
		properties.streamBuffer.totalLength ?? getBufferLength(properties.buffer)
	);
}

function createSilentBuffer(channels: number, length: number): Float32Array[] {
	return Array.from({ length: channels }, () => new Float32Array(length));
}

function reconcileStreamEndedState(streamBuffer: StreamBufferState): void {
	if (!streamBuffer.endRequested) {
		streamBuffer.streamEnded = false;
		return;
	}
	if (streamBuffer.totalLength == null) {
		streamBuffer.streamEnded = true;
		return;
	}
	streamBuffer.streamEnded =
		streamBuffer.committedLength >= streamBuffer.totalLength;
}

function resetLowWaterState(
	streamBuffer: StreamBufferState,
	playhead: number,
): void {
	if (
		streamBuffer.committedLength - Math.floor(playhead) >=
		streamBuffer.lowWaterThreshold
	) {
		streamBuffer.lowWaterNotified = false;
	}
}

/**
 * Advance committedLength by consuming any seekSpans that start at or before
 * the current committedLength. O(MAX_SEEK_SPANS) — no allocation.
 */
function drainSeekSpans(streamBuffer: StreamBufferState): void {
	let merged = true;
	while (merged && streamBuffer.seekSpans.length > 0) {
		merged = false;
		for (let i = 0; i < streamBuffer.seekSpans.length; i++) {
			const span = streamBuffer.seekSpans[i];
			if (span !== undefined && span.startSample <= streamBuffer.committedLength) {
				if (span.endSample > streamBuffer.committedLength) {
					streamBuffer.committedLength = span.endSample;
				}
				// Remove by swapping with last element (O(1))
				const last = streamBuffer.seekSpans[streamBuffer.seekSpans.length - 1];
				if (last !== undefined) streamBuffer.seekSpans[i] = last;
				streamBuffer.seekSpans.pop();
				merged = true;
				break;
			}
		}
	}
}

/**
 * Add a non-sequential span to seekSpans, merging with existing overlapping
 * entries. Evicts the smallest span when at MAX_SEEK_SPANS capacity.
 */
function addSeekSpan(
	streamBuffer: StreamBufferState,
	startSample: number,
	endSample: number,
): void {
	// Try to merge with an existing overlapping or adjacent span
	for (let i = 0; i < streamBuffer.seekSpans.length; i++) {
		const span = streamBuffer.seekSpans[i];
		if (span !== undefined &&
			startSample <= span.endSample &&
			endSample >= span.startSample
		) {
			span.startSample = Math.min(span.startSample, startSample);
			span.endSample = Math.max(span.endSample, endSample);
			return;
		}
	}
	// Evict when at capacity: drop the span with smallest endSample
	if (streamBuffer.seekSpans.length >= MAX_SEEK_SPANS) {
		let minIdx = 0;
		for (let i = 1; i < streamBuffer.seekSpans.length; i++) {
			if ((streamBuffer.seekSpans[i]?.endSample ?? 0) <
				(streamBuffer.seekSpans[minIdx]?.endSample ?? 0)) {
				minIdx = i;
			}
		}
		streamBuffer.seekSpans.splice(minIdx, 1);
	}
	streamBuffer.seekSpans.push({ startSample, endSample });
}

function ensureBufferCapacity(
	properties: Required<ClipProcessorOptions>,
	requiredChannels: number,
	requiredLength: number,
): void {
	const currentLength = getBufferLength(properties.buffer);
	const currentChannels = properties.buffer.length;
	if (currentLength >= requiredLength && currentChannels >= requiredChannels) {
		return;
	}

	// Guard: do not reallocate while streaming — that would cause a catastrophic
	// GC pause in the audio render thread. Clamp to the existing buffer length.
	if (properties.streamBuffer.streamingActive) {
		if (process.env.NODE_ENV !== "production") {
			console.warn(
				`ensureBufferCapacity: over-size write during streaming — clamping write to buffer bounds. ` +
				`requiredLength=${requiredLength}, bufferLength=${currentLength}`,
			);
		}
		return;
	}

	const nextLength = Math.max(currentLength, requiredLength);
	const nextChannels = Math.max(currentChannels, requiredChannels);
	const nextBuffer = createSilentBuffer(nextChannels, nextLength);
	for (let ch = 0; ch < currentChannels; ch++) {
		nextBuffer[ch].set(properties.buffer[ch].subarray(0, currentLength));
	}
	properties.buffer = nextBuffer;
	if (
		properties.streamBuffer.totalLength == null ||
		properties.streamBuffer.totalLength < nextLength
	) {
		properties.streamBuffer.totalLength = nextLength;
	}
}

export function applyBufferRangeWrite(
	properties: Required<ClipProcessorOptions>,
	write: BufferRangeWrite,
): void {
	const startSample = Math.max(Math.floor(write.startSample), 0);
	let writeLength = write.channelData[0]?.length ?? 0;
	const requestedTotalLength = write.totalLength ?? null;

	if (requestedTotalLength != null) {
		properties.streamBuffer.totalLength = requestedTotalLength;
	}

	const bufferLength = getBufferLength(properties.buffer);

	if (writeLength > 0) {
		const requiredLength = Math.max(
			startSample + writeLength,
			requestedTotalLength ?? 0,
		);
		ensureBufferCapacity(
			properties,
			Math.max(write.channelData.length, properties.buffer.length, 1),
			requiredLength,
		);

		// Clamp write to buffer bounds (streaming guard may have suppressed realloc)
		const clampedEnd = Math.min(startSample + writeLength, bufferLength);
		writeLength = Math.max(clampedEnd - startSample, 0);

		for (let ch = 0; ch < write.channelData.length; ch++) {
			const src = write.channelData[ch];
			if (src !== undefined && writeLength > 0) {
				properties.buffer[ch].set(
					writeLength < src.length ? src.subarray(0, writeLength) : src,
					startSample,
				);
			}
		}

		// Update committedLength — zero-allocation fast path for sequential writes
		if (startSample === properties.streamBuffer.committedLength) {
			properties.streamBuffer.committedLength += writeLength;
			// Drain any seek spans that are now contiguous
			if (properties.streamBuffer.seekSpans.length > 0) {
				drainSeekSpans(properties.streamBuffer);
			}
		} else {
			// Non-sequential (seek-origin) write — use the fixed seek span ring
			addSeekSpan(
				properties.streamBuffer,
				startSample,
				startSample + writeLength,
			);
			drainSeekSpans(properties.streamBuffer);
		}

		properties.streamBuffer.maxWrittenSample = Math.max(
			properties.streamBuffer.maxWrittenSample,
			startSample + writeLength,
		);
	}

	if (write.streamEnded === true) {
		properties.streamBuffer.endRequested = true;
	}
	reconcileStreamEndedState(properties.streamBuffer);
	resetLowWaterState(properties.streamBuffer, properties.playhead);
}

function setWholeBuffer(
	properties: Required<ClipProcessorOptions>,
	buffer: Float32Array[],
): void {
	properties.buffer = buffer;
	properties.streamBuffer = createStreamBufferState(buffer);
}

// ---------------------------------------------------------------------------
// Properties & offset
// ---------------------------------------------------------------------------

export function getProperties(
	opts: ClipProcessorOptions = {},
	sampleRate: number,
): Required<ClipProcessorOptions> {
	const {
		buffer = [],
		streamBuffer = createStreamBufferState(buffer),
		duration = -1,
		loop = false,
		loopMode = "forward" as const,
		loopStart = 0,
		loopEnd = (buffer[0]?.length ?? 0) / sampleRate,
		loopCrossfade = 0,
		loopCrossfadeOffset = 0,
		playhead = 0,
		playbackDirection = 1 as const,
		offset = 0,
		startWhen = 0,
		stopWhen = 0,
		pauseWhen = 0,
		resumeWhen = 0,
		playedSamples = 0,
		state = State.Initial,
		timesLooped = 0,
		fadeInDuration = 0,
		fadeOutDuration = 0,
		enableFadeIn = fadeInDuration > 0,
		enableFadeOut = fadeOutDuration > 0,
		enableLoopStart = true,
		enableLoopEnd = true,
		enableLoopCrossfade = loopCrossfade > 0,
		enableHighpass = true,
		enableLowpass = true,
		enableGain = true,
		enablePan = true,
		enableDetune = true,
		enablePlaybackRate = true,
		enableFrameReporting = false,
		muted = false,
	} = opts;

	return {
		buffer,
		streamBuffer,
		loop,
		loopMode,
		loopStart,
		loopEnd,
		loopCrossfade,
		loopCrossfadeOffset,
		duration,
		playhead,
		playbackDirection,
		offset,
		startWhen,
		stopWhen,
		pauseWhen,
		resumeWhen,
		playedSamples,
		state,
		timesLooped,
		fadeInDuration,
		fadeOutDuration,
		enableFadeIn,
		enableFadeOut,
		enableLoopStart,
		enableLoopEnd,
		enableHighpass,
		enableLowpass,
		enableGain,
		enablePan,
		enableDetune,
		enablePlaybackRate,
		enableLoopCrossfade,
		enableFrameReporting,
		muted,
	};
}

function getBufferDurationSeconds(
	properties: Required<ClipProcessorOptions>,
	sampleRate: number,
): number {
	return getLogicalBufferLength(properties) / sampleRate;
}

function normalizeLoopBounds(
	properties: Required<ClipProcessorOptions>,
	sampleRate: number,
): void {
	const bufferDuration = getBufferDurationSeconds(properties, sampleRate);
	if (bufferDuration <= 0) {
		properties.loopStart = 0;
		properties.loopEnd = 0;
		return;
	}

	if (!Number.isFinite(properties.loopStart) || properties.loopStart < 0) {
		properties.loopStart = 0;
	}
	if (properties.loopStart >= bufferDuration) {
		properties.loopStart = 0;
	}
	if (
		!Number.isFinite(properties.loopEnd) ||
		properties.loopEnd <= properties.loopStart ||
		properties.loopEnd > bufferDuration
	) {
		properties.loopEnd = bufferDuration;
	}
}

export function setOffset(
	properties: Required<ClipProcessorOptions>,
	offset: number | undefined,
	sampleRate: number,
): number {
	if (offset === undefined) {
		properties.offset = 0;
		return 0;
	}
	if (offset < 0) {
		return setOffset(
			properties,
			getLogicalBufferLength(properties) + offset,
			sampleRate,
		);
	}
	if (offset > (getLogicalBufferLength(properties) || 1) - 1) {
		return setOffset(
			properties,
			getLogicalBufferLength(properties) % offset,
			sampleRate,
		);
	}
	const offs = Math.floor(offset * sampleRate);
	properties.offset = offs;
	return offs;
}

// ---------------------------------------------------------------------------
// Index calculation
// ---------------------------------------------------------------------------

export function findIndexesNormal(p: BlockParameters): BlockReturnState {
	const {
		playhead,
		bufferLength,
		loop,
		loopStartSamples,
		loopEndSamples,
		loopMode = "forward",
		playbackDirection: initialDirection = 1,
	} = p;
	let length = 128;
	if (!loop && playhead + 128 > bufferLength) {
		length = Math.max(bufferLength - playhead, 0);
	}
	const indexes: number[] = new Array(length);

	if (!loop) {
		for (let i = 0, head = playhead; i < length; i++, head++) {
			indexes[i] = head;
		}
		const nextPlayhead = playhead + length;
		return {
			playhead: nextPlayhead,
			indexes,
			looped: false,
			ended: nextPlayhead >= bufferLength,
			playbackDirection: initialDirection,
		};
	}

	let head = playhead;
	let looped = false;
	let dir = initialDirection;

	if (loopMode === "boomerang") {
		for (let i = 0; i < length; i++) {
			indexes[i] = Math.min(Math.max(Math.floor(head), 0), bufferLength - 1);
			head += dir;
			if (dir > 0 && head >= loopEndSamples) {
				head = loopEndSamples - 1;
				dir = -1;
				looped = true;
			} else if (dir < 0 && head < loopStartSamples) {
				head = loopStartSamples;
				dir = 1;
				looped = true;
			}
		}
	} else {
		for (let i = 0; i < length; i++, head++) {
			if (head >= loopEndSamples) {
				head = loopStartSamples + (head - loopEndSamples);
				looped = true;
			}
			indexes[i] = head;
		}
	}
	return {
		indexes,
		looped,
		ended: false,
		playhead: head,
		playbackDirection: dir,
	};
}

export function findIndexesWithPlaybackRates(
	p: BlockParameters,
): BlockReturnState {
	const {
		playhead,
		bufferLength,
		loop,
		loopStartSamples,
		loopEndSamples,
		loopMode = "forward",
		playbackDirection: initialDirection = 1,
		playbackRates,
	} = p;
	let length = 128;
	if (!loop && playhead + 128 > bufferLength) {
		length = Math.max(bufferLength - playhead, 0);
	}
	const indexes: number[] = new Array(length);
	let head = playhead;
	let looped = false;
	let dir = initialDirection;

	if (loop) {
		if (loopMode === "boomerang") {
			for (let i = 0; i < length; i++) {
				indexes[i] = Math.min(Math.max(Math.floor(head), 0), bufferLength - 1);
				const rate = Math.abs(playbackRates[i] ?? playbackRates[0] ?? 1);
				head += rate * dir;
				if (dir > 0 && head >= loopEndSamples) {
					head = loopEndSamples - 1;
					dir = -1;
					looped = true;
				} else if (dir < 0 && head < loopStartSamples) {
					head = loopStartSamples;
					dir = 1;
					looped = true;
				}
			}
		} else {
			for (let i = 0; i < length; i++) {
				indexes[i] = Math.min(Math.max(Math.floor(head), 0), bufferLength - 1);
				const rate = playbackRates[i] ?? playbackRates[0] ?? 1;
				head += rate;
				if (rate >= 0 && (head > loopEndSamples || head > bufferLength)) {
					head = loopStartSamples;
					looped = true;
				} else if (rate < 0 && (head < loopStartSamples || head < 0)) {
					head = loopEndSamples;
					looped = true;
				}
			}
		}
		return {
			playhead: head,
			indexes,
			looped,
			ended: false,
			playbackDirection: dir,
		};
	}

	for (let i = 0; i < length; i++) {
		indexes[i] = Math.min(Math.max(Math.floor(head), 0), bufferLength - 1);
		head += playbackRates[i] ?? playbackRates[0] ?? 1;
	}
	return {
		playhead: head,
		indexes,
		looped: false,
		ended: head >= bufferLength || head < 0,
		playbackDirection: dir,
	};
}

// ---------------------------------------------------------------------------
// Buffer operations
// ---------------------------------------------------------------------------

export function fill(
	target: Float32Array[],
	source: Float32Array[],
	indexes: number[],
): void {
	const nc = Math.min(target.length, source.length);
	for (let i = 0; i < indexes.length; i++) {
		for (let ch = 0; ch < nc; ch++) {
			target[ch][i] = source[ch][indexes[i]];
		}
	}
	for (let ch = nc; ch < target.length; ch++) {
		for (let i = 0; i < target[ch].length; i++) {
			target[ch][i] = 0;
		}
	}
	for (let i = indexes.length; i < target[0].length; i++) {
		for (let ch = 0; ch < nc; ch++) {
			target[ch][i] = 0;
		}
	}
}

export function fillWithSilence(buffer: Float32Array[]): void {
	for (let ch = 0; ch < buffer.length; ch++) {
		for (let j = 0; j < buffer[ch].length; j++) {
			buffer[ch][j] = 0;
		}
	}
}

export function monoToStereo(signal: Float32Array[]): void {
	if (signal.length >= 2) {
		// Output already has a second channel — copy mono data into it
		for (let i = 0; i < signal[0].length; i++) {
			signal[1][i] = signal[0][i];
		}
	} else {
		const r = new Float32Array(signal[0].length);
		for (let i = 0; i < signal[0].length; i++) {
			r[i] = signal[0][i];
		}
		signal.push(r);
	}
}

export function copy(source: Float32Array[], target: Float32Array[]): void {
	for (let i = target.length; i < source.length; i++) {
		target[i] = new Float32Array(source[i].length);
	}
	for (let ch = 0; ch < source.length; ch++) {
		for (let i = 0; i < source[ch].length; i++) {
			target[ch][i] = source[ch][i];
		}
	}
}

export function checkNans(output: Float32Array[]): number {
	let numNans = 0;
	for (let ch = 0; ch < output.length; ch++) {
		for (let j = 0; j < output[ch].length; j++) {
			if (Number.isNaN(output[ch][j])) {
				numNans++;
				output[ch][j] = 0;
			}
		}
	}
	return numNans;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface BiquadState {
	x_1: number;
	x_2: number;
	y_1: number;
	y_2: number;
}

export function createFilterState(): BiquadState[] {
	return [
		{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
		{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
	];
}

export function gainFilter(arr: Float32Array[], gains: Float32Array): void {
	if (gains.length === 1) {
		const g = gains[0];
		if (g === 1) return;
		for (const ch of arr) {
			for (let i = 0; i < ch.length; i++) ch[i] *= g;
		}
		return;
	}
	let g = gains[0];
	for (const ch of arr) {
		for (let i = 0; i < ch.length; i++) {
			g = gains[i] ?? g;
			ch[i] *= g;
		}
	}
}

export function panFilter(signal: Float32Array[], pans: Float32Array): void {
	let pan = pans[0];
	for (let i = 0; i < signal[0].length; i++) {
		pan = pans[i] ?? pan;
		const leftGain = pan <= 0 ? 1 : 1 - pan;
		const rightGain = pan >= 0 ? 1 : 1 + pan;
		signal[0][i] *= leftGain;
		signal[1][i] *= rightGain;
	}
}

export function lowpassFilter(
	buffer: Float32Array[],
	cutoffs: Float32Array,
	sampleRate: number,
	states: BiquadState[],
): void {
	for (let channel = 0; channel < buffer.length; channel++) {
		const arr = buffer[channel];
		let { x_1, x_2, y_1, y_2 } = states[channel] ?? {
			x_1: 0,
			x_2: 0,
			y_1: 0,
			y_2: 0,
		};
		if (cutoffs.length === 1) {
			const cutoff = cutoffs[0];
			if (cutoff >= 20000) return;
			const w0 = (2 * Math.PI * cutoff) / sampleRate;
			const alpha = Math.sin(w0) / 2;
			const b0 = (1 - Math.cos(w0)) / 2;
			const b1 = 1 - Math.cos(w0);
			const b2 = (1 - Math.cos(w0)) / 2;
			const a0 = 1 + alpha;
			const a1 = -2 * Math.cos(w0);
			const a2 = 1 - alpha;
			const h0 = b0 / a0,
				h1 = b1 / a0,
				h2 = b2 / a0,
				h3 = a1 / a0,
				h4 = a2 / a0;
			for (let i = 0; i < arr.length; i++) {
				const x = arr[i];
				const y = h0 * x + h1 * x_1 + h2 * x_2 - h3 * y_1 - h4 * y_2;
				x_2 = x_1;
				x_1 = x;
				y_2 = y_1;
				y_1 = y;
				arr[i] = y;
			}
		} else {
			const prevCutoff = cutoffs[0];
			for (let i = 0; i < arr.length; i++) {
				const cutoff = cutoffs[i] ?? prevCutoff;
				const w0 = (2 * Math.PI * cutoff) / sampleRate;
				const alpha = Math.sin(w0) / 2;
				const b0 = (1 - Math.cos(w0)) / 2;
				const b1 = 1 - Math.cos(w0);
				const b2 = (1 - Math.cos(w0)) / 2;
				const a0 = 1 + alpha;
				const a1 = -2 * Math.cos(w0);
				const a2 = 1 - alpha;
				const x = arr[i];
				const y =
					(b0 / a0) * x +
					(b1 / a0) * x_1 +
					(b2 / a0) * x_2 -
					(a1 / a0) * y_1 -
					(a2 / a0) * y_2;
				x_2 = x_1;
				x_1 = x;
				y_2 = y_1;
				y_1 = y;
				arr[i] = y;
			}
		}
		states[channel] = { x_1, x_2, y_1, y_2 };
	}
}

export function highpassFilter(
	buffer: Float32Array[],
	cutoffs: Float32Array,
	sampleRate: number,
	states: BiquadState[],
): void {
	for (let channel = 0; channel < buffer.length; channel++) {
		const arr = buffer[channel];
		let { x_1, x_2, y_1, y_2 } = states[channel] ?? {
			x_1: 0,
			x_2: 0,
			y_1: 0,
			y_2: 0,
		};
		if (cutoffs.length === 1) {
			const cutoff = cutoffs[0];
			if (cutoff <= 20) return;
			const w0 = (2 * Math.PI * cutoff) / sampleRate;
			const alpha = Math.sin(w0) / 2;
			const b0 = (1 + Math.cos(w0)) / 2;
			const b1 = -(1 + Math.cos(w0));
			const b2 = (1 + Math.cos(w0)) / 2;
			const a0 = 1 + alpha;
			const a1 = -2 * Math.cos(w0);
			const a2 = 1 - alpha;
			for (let i = 0; i < arr.length; i++) {
				const x = arr[i];
				const y =
					(b0 / a0) * x +
					(b1 / a0) * x_1 +
					(b2 / a0) * x_2 -
					(a1 / a0) * y_1 -
					(a2 / a0) * y_2;
				x_2 = x_1;
				x_1 = x;
				y_2 = y_1;
				y_1 = y;
				arr[i] = y;
			}
		} else {
			const prevCutoff = cutoffs[0];
			for (let i = 0; i < arr.length; i++) {
				const cutoff = cutoffs[i] ?? prevCutoff;
				const w0 = (2 * Math.PI * cutoff) / sampleRate;
				const alpha = Math.sin(w0) / 2;
				const b0 = (1 + Math.cos(w0)) / 2;
				const b1 = -(1 + Math.cos(w0));
				const b2 = (1 + Math.cos(w0)) / 2;
				const a0 = 1 + alpha;
				const a1 = -2 * Math.cos(w0);
				const a2 = 1 - alpha;
				const x = arr[i];
				const y =
					(b0 / a0) * x +
					(b1 / a0) * x_1 +
					(b2 / a0) * x_2 -
					(a1 / a0) * y_1 -
					(a2 / a0) * y_2;
				x_2 = x_1;
				x_1 = x;
				y_2 = y_1;
				y_1 = y;
				arr[i] = y;
			}
		}
		states[channel] = { x_1, x_2, y_1, y_2 };
	}
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

export interface OutboundMessage {
	type: string;
	data?: unknown;
}

export function handleProcessorMessage(
	properties: Required<ClipProcessorOptions>,
	message: { type: string; data?: unknown },
	currentTime: number,
	sampleRate: number,
): OutboundMessage[] {
	const { type, data } = message;
	switch (type) {
		case "buffer":
			setWholeBuffer(properties, data as Float32Array[]);
			normalizeLoopBounds(properties, sampleRate);
			return [];
		case "bufferInit": {
			const init = data as {
				channels: number;
				totalLength: number;
				streaming?: boolean;
			};
			properties.buffer = createSilentBuffer(init.channels, init.totalLength);
			const isStreaming = init.streaming ?? true;
			properties.streamBuffer = {
				...createStreamBufferState(),
				totalLength: init.totalLength,
				endRequested: false,
				streamEnded: false,
				streaming: isStreaming,
				streamingActive: isStreaming,
			};
			normalizeLoopBounds(properties, sampleRate);
			return [];
		}
		case "bufferRange":
			applyBufferRangeWrite(properties, data as BufferRangeWrite);
			return [];
		case "bufferEnd": {
			const endData = data as { totalLength?: number } | undefined;
			if (endData?.totalLength != null) {
				properties.streamBuffer.totalLength = endData.totalLength;
			}
			properties.streamBuffer.endRequested = true;
			reconcileStreamEndedState(properties.streamBuffer);
			return [];
		}
		case "bufferReset":
			properties.buffer = [];
			properties.streamBuffer = createStreamBufferState();
			normalizeLoopBounds(properties, sampleRate);
			return [];
		case "start":
			properties.timesLooped = 0;
			{
				const d = data as
					| { duration?: number; offset?: number; when?: number }
					| undefined;
				properties.duration = d?.duration ?? -1;
				if (properties.duration === -1) {
					properties.duration = properties.loop
						? Number.MAX_SAFE_INTEGER
						: (properties.buffer[0]?.length ?? 0) / sampleRate;
				}
				setOffset(properties, d?.offset, sampleRate);
				normalizeLoopBounds(properties, sampleRate);
				properties.playhead = properties.offset;
				properties.playbackDirection = 1;
				properties.startWhen = d?.when ?? currentTime;
				properties.stopWhen = properties.startWhen + properties.duration;
				properties.playedSamples = 0;
				properties.state = State.Scheduled;
			}
			return [{ type: "scheduled" }];
		case "stop":
			if (
				properties.state === State.Ended ||
				properties.state === State.Initial
			)
				return [];
			properties.stopWhen = (data as number | undefined) ?? properties.stopWhen;
			properties.state = State.Stopped;
			return [{ type: "stopped" }];
		case "pause":
			properties.state = State.Paused;
			properties.pauseWhen = (data as number | undefined) ?? currentTime;
			return [{ type: "paused" }];
		case "resume":
			properties.state = State.Started;
			properties.startWhen = (data as number | undefined) ?? currentTime;
			return [{ type: "resume" }];
		case "dispose":
			properties.state = State.Disposed;
			properties.buffer = [];
			properties.streamBuffer = createStreamBufferState();
			return [{ type: "disposed" }];
		case "loop": {
			const loop = data as boolean;
			const st = properties.state;
			if (loop && (st === State.Scheduled || st === State.Started)) {
				properties.stopWhen = Number.MAX_SAFE_INTEGER;
				properties.duration = Number.MAX_SAFE_INTEGER;
			}
			properties.loop = loop;
			if (loop) {
				normalizeLoopBounds(properties, sampleRate);
			}
			return [];
		}
		case "loopMode":
			properties.loopMode = data as LoopMode;
			properties.playbackDirection = 1;
			return [];
		case "loopStart":
			properties.loopStart = data as number;
			return [];
		case "loopEnd":
			properties.loopEnd = data as number;
			return [];
		case "loopCrossfade":
			properties.loopCrossfade = data as number;
			properties.enableLoopCrossfade = properties.loopCrossfade > 0;
			return [];
		case "loopCrossfadeOffset":
			properties.loopCrossfadeOffset = Math.max(
				-1,
				Math.min(1, data as number),
			);
			return [];
		case "playhead":
			properties.playhead = Math.floor(data as number);
			return [];
		case "fadeIn":
			properties.fadeInDuration = data as number;
			properties.enableFadeIn = properties.fadeInDuration > 0;
			return [];
		case "fadeOut":
			properties.fadeOutDuration = data as number;
			properties.enableFadeOut = properties.fadeOutDuration > 0;
			return [];
		case "toggleGain":
			properties.enableGain =
				(data as boolean | undefined) ?? !properties.enableGain;
			return [];
		case "togglePan":
			properties.enablePan =
				(data as boolean | undefined) ?? !properties.enablePan;
			return [];
		case "toggleLowpass":
			properties.enableLowpass =
				(data as boolean | undefined) ?? !properties.enableLowpass;
			return [];
		case "toggleHighpass":
			properties.enableHighpass =
				(data as boolean | undefined) ?? !properties.enableHighpass;
			return [];
		case "toggleDetune":
			properties.enableDetune =
				(data as boolean | undefined) ?? !properties.enableDetune;
			return [];
		case "togglePlaybackRate":
			properties.enablePlaybackRate =
				(data as boolean | undefined) ?? !properties.enablePlaybackRate;
			return [];
		case "toggleFadeIn":
			properties.enableFadeIn =
				(data as boolean | undefined) ?? !properties.enableFadeIn;
			return [];
		case "toggleFadeOut":
			properties.enableFadeOut =
				(data as boolean | undefined) ?? !properties.enableFadeOut;
			return [];
		case "toggleLoopStart":
			properties.enableLoopStart =
				(data as boolean | undefined) ?? !properties.enableLoopStart;
			return [];
		case "toggleLoopEnd":
			properties.enableLoopEnd =
				(data as boolean | undefined) ?? !properties.enableLoopEnd;
			return [];
		case "toggleLoopCrossfade":
			properties.enableLoopCrossfade =
				(data as boolean | undefined) ?? !properties.enableLoopCrossfade;
			return [];
		case "logState":
			return [];
		case "enableFrameReporting":
			properties.enableFrameReporting = data as boolean;
			return [];
		case "mute":
			properties.muted = data as boolean;
			return [];
	}
	return [];
}

// ---------------------------------------------------------------------------
// Process block
// ---------------------------------------------------------------------------

export interface ProcessContext {
	currentTime: number;
	currentFrame: number;
	sampleRate: number;
}

export interface ProcessResult {
	keepAlive: boolean;
	messages: OutboundMessage[];
}

export function processBlock(
	props: Required<ClipProcessorOptions>,
	outputs: Float32Array[][],
	parameters: Record<string, Float32Array>,
	ctx: ProcessContext,
	filterState: { lowpass: BiquadState[]; highpass: BiquadState[] },
): ProcessResult {
	const messages: OutboundMessage[] = [];
	let state = props.state;
	if (state === State.Disposed) return { keepAlive: false, messages };

	// Buffer writes are now applied in port.onmessage before process() is called.
	// No pending write queue to drain here.

	if (state === State.Initial) return { keepAlive: true, messages };

	if (state === State.Ended) {
		fillWithSilence(outputs[0]);
		return { keepAlive: true, messages };
	}

	if (state === State.Scheduled) {
		if (ctx.currentTime >= props.startWhen) {
			state = props.state = State.Started;
			messages.push({ type: "started" });
		} else {
			fillWithSilence(outputs[0]);
			return { keepAlive: true, messages };
		}
	} else if (state === State.Paused) {
		if (ctx.currentTime > props.pauseWhen) {
			fillWithSilence(outputs[0]);
			return { keepAlive: true, messages };
		}
	}

	if (ctx.currentTime > props.stopWhen) {
		fillWithSilence(outputs[0]);
		props.state = State.Ended;
		messages.push({ type: "ended" });
		props.playedSamples = 0;
		return { keepAlive: true, messages };
	}

	const output0 = outputs[0];
	const sourceLength = getLogicalBufferLength(props);
	if (sourceLength === 0) {
		fillWithSilence(output0);
		return { keepAlive: true, messages };
	}

	const {
		playbackRate: playbackRates,
		detune: detunes,
		lowpass,
		highpass,
		gain: gains,
		pan: pans,
	} = parameters;

	const {
		buffer,
		loopStart,
		loopEnd,
		loopCrossfade,
		loopCrossfadeOffset,
		stopWhen,
		playedSamples,
		enableLowpass,
		enableHighpass,
		enableGain,
		enablePan,
		enableDetune,
		enableFadeOut,
		enableFadeIn,
		enableLoopStart,
		enableLoopEnd,
		enableLoopCrossfade,
		playhead,
		fadeInDuration,
		fadeOutDuration,
	} = props;
	const hasIncompleteStream =
		props.streamBuffer.streaming &&
		props.streamBuffer.committedLength < sourceLength;
	const loop = props.loop;

	// When looping during an incomplete stream, clamp effective length to committed data
	// to avoid reading silence/unwritten regions.
	const effectiveSourceLength = hasIncompleteStream
		? Math.max(props.streamBuffer.committedLength, 0)
		: sourceLength;

	// Guard against degenerate tiny loops that would produce audible artifacts
	const MIN_LOOP_SAMPLES = SAMPLE_BLOCK_SIZE * 2;
	if (hasIncompleteStream && loop && effectiveSourceLength < MIN_LOOP_SAMPLES) {
		fillWithSilence(output0);
		for (let i = 1; i < outputs.length; i++) {
			copy(output0, outputs[i]);
		}
		return { keepAlive: true, messages };
	}

	const nc = Math.min(buffer.length, output0.length);
	const durationSamples = props.duration * ctx.sampleRate;

	const loopCrossfadeSamples = Math.floor(ctx.sampleRate * loopCrossfade);
	const maxLoopStartSample = Math.max(
		effectiveSourceLength - SAMPLE_BLOCK_SIZE,
		0,
	);
	const loopStartSamples = enableLoopStart
		? Math.min(Math.floor(loopStart * ctx.sampleRate), maxLoopStartSample)
		: 0;
	const loopEndSamples = enableLoopEnd
		? Math.min(Math.floor(loopEnd * ctx.sampleRate), effectiveSourceLength)
		: effectiveSourceLength;
	const loopLengthSamples = loopEndSamples - loopStartSamples;

	// Apply detune to playback rates: effectiveRate = rate * 2^(detune/1200)
	const needsDetune = enableDetune && detunes.length > 0 && detunes[0] !== 0;
	let effectiveRates = playbackRates;
	if (needsDetune) {
		const len = Math.max(
			playbackRates.length,
			detunes.length,
			SAMPLE_BLOCK_SIZE,
		);
		effectiveRates = new Float32Array(len);
		for (let i = 0; i < len; i++) {
			const rate = playbackRates[i] ?? playbackRates[playbackRates.length - 1];
			const cents = detunes[i] ?? detunes[detunes.length - 1];
			effectiveRates[i] = rate * 2 ** (cents / 1200);
		}
	}

	const useRateIndexing = props.enablePlaybackRate || needsDetune;
	const isZeroRateBlock =
		useRateIndexing &&
		effectiveRates.length > 0 &&
		effectiveRates.every((rate) => rate === 0);

	if (
		props.streamBuffer.streaming &&
		!props.streamBuffer.streamEnded &&
		!props.streamBuffer.lowWaterNotified &&
		props.streamBuffer.committedLength - Math.floor(playhead) <
			props.streamBuffer.lowWaterThreshold
	) {
		messages.push({
			type: "bufferLowWater",
			data: {
				playhead: Math.floor(playhead),
				committedLength: props.streamBuffer.committedLength,
			},
		});
		props.streamBuffer.lowWaterNotified = true;
	}

	if (isZeroRateBlock) {
		fillWithSilence(output0);
		for (let i = 1; i < outputs.length; i++) {
			copy(output0, outputs[i]);
		}
		return { keepAlive: true, messages };
	}

	const blockParams: BlockParameters = {
		bufferLength: effectiveSourceLength,
		loop,
		loopMode: props.loopMode,
		playbackDirection: props.playbackDirection,
		playhead: props.playhead,
		loopStartSamples,
		loopEndSamples,
		durationSamples,
		playbackRates: effectiveRates,
	};

	const {
		indexes,
		ended,
		looped,
		playhead: updatedPlayhead,
		playbackDirection: updatedDirection,
	} = useRateIndexing
		? findIndexesWithPlaybackRates(blockParams)
		: findIndexesNormal(blockParams);
	const waitingForFinalCommit =
		props.streamBuffer.streaming &&
		props.streamBuffer.endRequested &&
		!props.streamBuffer.streamEnded;
	const hasUnfinishedStreamTail =
		props.streamBuffer.streaming && hasIncompleteStream;

	const underrunSample = indexes.find(
		(index) =>
			index >= props.streamBuffer.committedLength && index < sourceLength,
	);
	if (
		underrunSample !== undefined &&
		!props.streamBuffer.streamEnded &&
		props.streamBuffer.lastUnderrunSample !== underrunSample
	) {
		messages.push({
			type: "bufferUnderrun",
			data: {
				playhead: Math.floor(playhead),
				committedLength: props.streamBuffer.committedLength,
				requestedSample: underrunSample,
			},
		});
		props.streamBuffer.lastUnderrunSample = underrunSample;
	} else if (underrunSample === undefined) {
		props.streamBuffer.lastUnderrunSample = null;
	}

	// Track underrun active state for recovery crossfade.
	// Underrun can be detected two ways:
	// 1. indexes land in uncommitted range (underrunSample !== undefined)
	// 2. In streaming mode, indexes are truncated because effectiveSourceLength
	//    was clamped to committedLength (partial block while stream not ended)
	const isStreamingUnderrun =
		hasUnfinishedStreamTail &&
		!props.streamBuffer.streamEnded &&
		indexes.length < SAMPLE_BLOCK_SIZE;
	const isUnderrunning =
		(underrunSample !== undefined && !props.streamBuffer.streamEnded) ||
		isStreamingUnderrun;

	if (isUnderrunning) {
		props.streamBuffer.underrunActive = true;
	} else if (props.streamBuffer.underrunActive && !isUnderrunning) {
		// Recovering from underrun — start fade-in
		props.streamBuffer.underrunActive = false;
		props.streamBuffer.underrunRecoveryPosition = 0;
	}

	fill(output0, buffer, indexes);

	// --- Underrun recovery fade-in ---
	if (
		props.streamBuffer.underrunRecoveryPosition <
		props.streamBuffer.underrunRecoverySamples
	) {
		const recoverySamples = props.streamBuffer.underrunRecoverySamples;
		const nc = output0.length;
		for (let i = 0; i < SAMPLE_BLOCK_SIZE; i++) {
			const pos = props.streamBuffer.underrunRecoveryPosition;
			if (pos >= recoverySamples) break;
			const gain = pos / recoverySamples;
			for (let ch = 0; ch < nc; ch++) {
				output0[ch][i] *= gain;
			}
			props.streamBuffer.underrunRecoveryPosition++;
		}
	}

	// --- Loop crossfade ---
	const xfadeNumSamples = Math.min(
		Math.floor(loopCrossfade * ctx.sampleRate),
		loopLengthSamples,
	);
	const isWithinLoopRange =
		loop && playhead > loopStartSamples && playhead < loopEndSamples;
	const needsCrossfade =
		enableLoopCrossfade &&
		loopCrossfadeSamples > 0 &&
		effectiveSourceLength > SAMPLE_BLOCK_SIZE;

	if (isWithinLoopRange && needsCrossfade) {
		const offsetShift = Math.floor((loopCrossfadeOffset * xfadeNumSamples) / 2);

		// Crossfade out at loop start: the new iteration fades in while previous
		// loop tail fades out.  Constant-gain: sin²+cos²=1.
		{
			const endIndex = loopStartSamples + xfadeNumSamples;
			if (
				xfadeNumSamples > 0 &&
				playhead > loopStartSamples &&
				playhead < endIndex
			) {
				const elapsed = playhead - loopStartSamples;
				const n = Math.min(Math.floor(endIndex - playhead), SAMPLE_BLOCK_SIZE);
				for (let i = 0; i < n; i++) {
					const position = (elapsed + i) / xfadeNumSamples;
					const s = Math.sin((Math.PI * position) / 2);
					const c = Math.cos((Math.PI * position) / 2);
					const gIn = s * s;
					const gOut = c * c;
					const srcIdx = Math.floor(
						loopEndSamples - xfadeNumSamples + elapsed + i - offsetShift,
					);
					if (srcIdx >= 0 && srcIdx < effectiveSourceLength) {
						for (let ch = 0; ch < nc; ch++) {
							output0[ch][i] = output0[ch][i] * gIn + buffer[ch][srcIdx] * gOut;
						}
					}
				}
			}
		}

		// Crossfade in approaching loop end: current audio fades out while the
		// start of the next iteration fades in.
		{
			const startIndex = loopEndSamples - xfadeNumSamples;
			if (
				xfadeNumSamples > 0 &&
				playhead > startIndex &&
				playhead < loopEndSamples
			) {
				const elapsed = playhead - startIndex;
				const n = Math.min(
					Math.floor(loopEndSamples - playhead),
					SAMPLE_BLOCK_SIZE,
				);
				for (let i = 0; i < n; i++) {
					const position = (elapsed + i) / xfadeNumSamples;
					const s = Math.sin((Math.PI * position) / 2);
					const c = Math.cos((Math.PI * position) / 2);
					const gOut = c * c;
					const gIn = s * s;
					const srcIdx = Math.floor(
						loopStartSamples + elapsed + i + offsetShift,
					);
					if (srcIdx >= 0 && srcIdx < effectiveSourceLength) {
						for (let ch = 0; ch < nc; ch++) {
							output0[ch][i] = output0[ch][i] * gOut + buffer[ch][srcIdx] * gIn;
						}
					}
				}
			}
		}
	}

	// --- Fade in ---
	if (enableFadeIn && fadeInDuration > 0) {
		const fadeInSamples = Math.floor(fadeInDuration * ctx.sampleRate);
		const remaining = fadeInSamples - playedSamples;
		if (remaining > 0) {
			const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
			for (let i = 0; i < n; i++) {
				const t = (playedSamples + i) / fadeInSamples;
				const g = t * t * t; // cubic: slow start, fast finish
				for (let ch = 0; ch < nc; ch++) {
					output0[ch][i] *= g;
				}
			}
		}
	}

	// --- Fade out ---
	if (enableFadeOut && fadeOutDuration > 0) {
		const fadeOutSamples = Math.floor(fadeOutDuration * ctx.sampleRate);
		const remainingSamples = Math.floor(
			ctx.sampleRate * (stopWhen - ctx.currentTime),
		);
		if (remainingSamples < fadeOutSamples + SAMPLE_BLOCK_SIZE) {
			for (let i = 0; i < SAMPLE_BLOCK_SIZE; i++) {
				const sampleRemaining = remainingSamples - i;
				if (sampleRemaining >= fadeOutSamples) continue; // not yet in fade zone
				const t = sampleRemaining <= 0 ? 0 : sampleRemaining / fadeOutSamples;
				const g = t * t * t; // cubic fade-out: fast drop, slow tail
				for (let ch = 0; ch < nc; ch++) {
					output0[ch][i] *= g;
				}
			}
		}
	}

	// --- Filters ---
	if (enableLowpass)
		lowpassFilter(output0, lowpass, ctx.sampleRate, filterState.lowpass);
	if (enableHighpass)
		highpassFilter(output0, highpass, ctx.sampleRate, filterState.highpass);
	if (enableGain) gainFilter(output0, gains);
	if (nc === 1) monoToStereo(output0);
	if (enablePan) panFilter(output0, pans);

	// --- Mute ---
	if (props.muted) {
		for (let ch = 0; ch < output0.length; ch++) {
			output0[ch].fill(0);
		}
	}

	if (looped) {
		props.timesLooped++;
		messages.push({ type: "looped", data: props.timesLooped });
	}
	if (ended && !waitingForFinalCommit && !hasUnfinishedStreamTail) {
		props.state = State.Ended;
		messages.push({ type: "ended" });
	}

	props.playedSamples += indexes.length;
	props.playhead = updatedPlayhead;
	props.playbackDirection = updatedDirection;

	const numNans = checkNans(output0);
	if (numNans > 0) {
		console.log({
			numNans,
			indexes,
			playhead: updatedPlayhead,
			ended,
			looped,
			sourceLength,
		});
		return { keepAlive: true, messages };
	}

	for (let i = 1; i < outputs.length; i++) {
		copy(output0, outputs[i]);
	}
	return { keepAlive: true, messages };
}
