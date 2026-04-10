// processor-kernel.ts — Pure DSP logic, state machine, all filters
// NO AudioWorklet or platform dependencies. Fully testable.

import {
	type BlockParameters,
	type BlockReturnState,
	type ClipProcessorOptions,
	State,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SAMPLE_BLOCK_SIZE = 128;

// ---------------------------------------------------------------------------
// Properties & offset
// ---------------------------------------------------------------------------

export function getProperties(
	opts: ClipProcessorOptions = {},
	sampleRate: number,
): Required<ClipProcessorOptions> {
	const {
		buffer = [],
		duration = -1,
		loop = false,
		loopStart = 0,
		loopEnd = (buffer[0]?.length ?? 0) / sampleRate,
		loopCrossfade = 0,
		playhead = 0,
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
	} = opts;

	return {
		buffer,
		loop,
		loopStart,
		loopEnd,
		loopCrossfade,
		duration,
		playhead,
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
	};
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
			(properties.buffer[0]?.length ?? 0) + offset,
			sampleRate,
		);
	}
	if (offset > (properties.buffer[0]?.length ?? 1) - 1) {
		return setOffset(
			properties,
			(properties.buffer[0]?.length ?? 0) % offset,
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
	const { playhead, bufferLength, loop, loopStartSamples, loopEndSamples } = p;
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
		};
	}

	let head = playhead;
	let looped = false;
	for (let i = 0; i < length; i++, head++) {
		if (head >= loopEndSamples) {
			head = loopStartSamples + (head - loopEndSamples);
			looped = true;
		}
		indexes[i] = head;
	}
	return { indexes, looped, ended: false, playhead: head };
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
		playbackRates,
	} = p;
	let length = 128;
	if (!loop && playhead + 128 > bufferLength) {
		length = Math.max(bufferLength - playhead, 0);
	}
	const indexes: number[] = new Array(length);
	let head = playhead;
	let looped = false;

	if (loop) {
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
		return { playhead: head, indexes, looped, ended: false };
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
	for (let i = 0; i < indexes.length; i++) {
		for (let ch = 0; ch < target.length; ch++) {
			target[ch][i] = source[ch][indexes[i]];
		}
	}
	for (let i = indexes.length; i < target[0].length; i++) {
		for (let ch = 0; ch < target.length; ch++) {
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
	const r = new Float32Array(signal[0].length);
	for (let i = 0; i < signal[0].length; i++) {
		r[i] = signal[0][i];
	}
	signal.push(r);
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
			properties.buffer = data as Float32Array[];
			return [];
		case "start":
			properties.timesLooped = 0;
			properties.loopStart ??= 0;
			properties.loopEnd ??= (properties.buffer[0]?.length ?? 0) / sampleRate;
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
				properties.playhead = properties.offset;
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
			return [{ type: "disposed" }];
		case "loop": {
			const loop = data as boolean;
			const st = properties.state;
			if (loop && (st === State.Scheduled || st === State.Started)) {
				properties.stopWhen = Number.MAX_SAFE_INTEGER;
				properties.duration = Number.MAX_SAFE_INTEGER;
			}
			properties.loop = loop;
			return [];
		}
		case "loopStart":
			properties.loopStart = data as number;
			return [];
		case "loopEnd":
			properties.loopEnd = data as number;
			return [];
		case "loopCrossfade":
			properties.loopCrossfade = data as number;
			return [];
		case "playhead":
			properties.playhead = Math.floor(data as number);
			return [];
		case "fadeIn":
			properties.fadeInDuration = data as number;
			return [];
		case "fadeOut":
			properties.fadeOutDuration = data as number;
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
	const sourceLength = props.buffer[0]?.length ?? 0;
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
		loop,
		loopStart,
		loopEnd,
		loopCrossfade,
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

	const nc = Math.min(buffer.length, output0.length);
	const durationSamples = props.duration * ctx.sampleRate;

	const loopCrossfadeSamples = Math.floor(ctx.sampleRate * loopCrossfade);
	const loopStartSamples = enableLoopStart
		? Math.min(
				Math.floor(loopStart * ctx.sampleRate),
				sourceLength - SAMPLE_BLOCK_SIZE,
			)
		: 0;
	const loopEndSamples = enableLoopEnd
		? Math.min(Math.floor(loopEnd * ctx.sampleRate), sourceLength)
		: sourceLength;
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

	const blockParams: BlockParameters = {
		bufferLength: sourceLength,
		loop,
		playhead,
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
	} = useRateIndexing
		? findIndexesWithPlaybackRates(blockParams)
		: findIndexesNormal(blockParams);

	fill(output0, buffer, indexes);

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
		sourceLength > SAMPLE_BLOCK_SIZE;

	if (isWithinLoopRange && needsCrossfade) {
		// Crossfade out at loop start
		{
			let endIndex = Math.min(
				loopStartSamples + xfadeNumSamples,
				loopEndSamples,
			);
			let numSamples = endIndex - loopStartSamples;
			if (loopEndSamples + numSamples > sourceLength) {
				numSamples = loopEndSamples - sourceLength;
				endIndex = loopStartSamples + numSamples;
			}
			if (numSamples > 0) {
				const isWithin = playhead > loopStartSamples && playhead < endIndex;
				if (isWithin) {
					const remaining = endIndex - playhead;
					let index = Math.floor(loopEndSamples + numSamples - remaining);
					const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
					for (let i = 0; i < n; i++) {
						index++;
						const position = (numSamples - remaining) / numSamples;
						const g = Math.cos((Math.PI * position) / 2);
						if (index >= 0 && index < sourceLength) {
							for (let ch = 0; ch < nc; ch++) {
								output0[ch][i] += buffer[ch][index] * g;
							}
						}
					}
				}
			}
		}

		// Crossfade in approaching loop end
		{
			let startIndex = Math.max(
				loopEndSamples - xfadeNumSamples,
				loopStartSamples,
			);
			let numSamples = loopEndSamples - startIndex;
			let firstIndex = loopStartSamples - numSamples;
			if (firstIndex < 0) {
				numSamples += firstIndex;
				startIndex = loopEndSamples - numSamples;
				firstIndex = 0;
			}
			if (numSamples > 0 && playhead > startIndex) {
				let remaining = loopEndSamples - playhead;
				let index = firstIndex + numSamples - remaining;
				const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
				for (let i = 0; i < n; i++) {
					index++;
					remaining--;
					const position = (numSamples - remaining) / numSamples;
					const g = Math.sin((Math.PI * position) / 2);
					if (index >= 0 && index < sourceLength) {
						for (let ch = 0; ch < nc; ch++) {
							output0[ch][i] += buffer[ch][index] * g;
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

	if (looped) {
		props.timesLooped++;
		messages.push({ type: "looped", data: props.timesLooped });
	}
	if (ended) {
		props.state = State.Ended;
		messages.push({ type: "ended" });
	}

	props.playedSamples += indexes.length;
	props.playhead = updatedPlayhead;

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
