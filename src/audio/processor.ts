// AudioWorklet processor — runs in AudioWorkletGlobalScope
// Bundled separately and served at /processor.js

declare const currentTime: number;
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean;
}

declare function registerProcessor(
	name: string,
	ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

export interface ClipProcessorOnmessageEvent {
	readonly data: ClipProcessorMessageRx;
}

export type ClipProcessorOnmessage = (ev: ClipProcessorOnmessageEvent) => void;

export interface ProcessorWorkletOptions extends AudioWorkletNodeOptions {
	readonly processorOptions?: ClipProcessorOptions;
}

export interface ClipProcessorStateMap {
	readonly Initial: 0;
	readonly Started: 1;
	readonly Stopped: 2;
	readonly Paused: 3;
	readonly Scheduled: 4;
	readonly Ended: 5;
	readonly Disposed: 6;
}

export type ClipProcessorState =
	ClipProcessorStateMap[keyof ClipProcessorStateMap];

export interface ClipWorkletOptions extends AudioWorkletNodeOptions {
	readonly processorOptions?: ClipProcessorOptions;
}

export interface ClipProcessorOptions {
	buffer?: Float32Array[];
	loop?: boolean;
	loopStart?: number;
	loopEnd?: number;
	loopCrossfade?: number;
	offset?: number;
	duration?: number;
	playhead?: number;
	state?: ClipProcessorState;
	startWhen?: number;
	stopWhen?: number;
	pauseWhen?: number;
	resumeWhen?: number;
	playedSamples?: number;
	timesLooped?: number;
	fadeInDuration?: number;
	fadeOutDuration?: number;
	enableFadeIn?: boolean;
	enableFadeOut?: boolean;
	enableLoopCrossfade?: boolean;
	enableGain?: boolean;
	enablePan?: boolean;
	enableHighpass?: boolean;
	enableLowpass?: boolean;
	enableDetune?: boolean;
	enablePlaybackRate?: boolean;
}

export interface BlockParameters {
	readonly playhead: number;
	readonly durationSamples: number;
	readonly loop: boolean;
	readonly loopStartSamples: number;
	readonly loopEndSamples: number;
	readonly bufferLength: number;
	readonly playbackRates: Float32Array;
}

export interface BlockReturnState {
	readonly playhead: number;
	readonly ended: boolean;
	readonly looped: boolean;
	readonly indexes: number[];
}

export type ClipProcessorMessageRx =
	| ClipProcessorBufferMessageRx
	| ClipProcessorStartMessageRx
	| ClipProcessorStopMessageRx
	| ClipProcessorPauseMessageRx
	| ClipProcessorResumeMessageRx
	| ClipProcessorDisposeMessageRx
	| ClipProcessorLoopMessageRx
	| ClipProcessorLoopStartMessageRx
	| ClipProcessorLoopEndMessageRx
	| ClipProcessorPlayheadMessageRx
	| ClipProcessorFadeInMessageRx
	| ClipProcessorFadeOutMessageRx
	| ClipProcessorLoopCrossfadeMessageRx
	| ClipProcessorToggleMessageRx
	| ClipProcessorLogStateMessageRx;

export type ClipProcessorMessageType =
	| "buffer"
	| "start"
	| "stop"
	| "pause"
	| "resume"
	| "dispose"
	| "loop"
	| "loopStart"
	| "loopEnd"
	| "playhead"
	| "playbackRate"
	| "offset"
	| "fadeIn"
	| "fadeOut"
	| "loopCrossfade"
	| ClipProcessorToggleMessageType
	| "logState";

export type ClipProcessorToggleMessageType =
	| "toggleFadeIn"
	| "toggleFadeOut"
	| "toggleLoopCrossfade"
	| "toggleGain"
	| "togglePan"
	| "toggleHighpass"
	| "toggleLowpass"
	| "toggleDetune"
	| "togglePlaybackRate";

export interface ClipProcessorLogStateMessageRx {
	readonly type: "logState";
	readonly data?: never;
}

export interface ClipProcessorToggleMessageRx {
	readonly type: ClipProcessorToggleMessageType;
	readonly data?: boolean;
}

export interface ClipProcessorBufferMessageRx {
	readonly type: "buffer";
	readonly data: Float32Array[];
}

export interface ClipProcessorStartMessageRx {
	readonly type: "start";
	readonly data?: {
		readonly duration?: number;
		readonly offset?: number;
		readonly when?: number;
	};
}

export interface ClipProcessorStopMessageRx {
	readonly type: "stop";
	readonly data?: number;
}

export interface ClipProcessorPauseMessageRx {
	readonly type: "pause";
	readonly data?: number;
}

export interface ClipProcessorResumeMessageRx {
	readonly type: "resume";
	readonly data?: number;
}

export interface ClipProcessorDisposeMessageRx {
	readonly type: "dispose";
	readonly data?: never;
}

export interface ClipProcessorLoopMessageRx {
	readonly type: "loop";
	readonly data: boolean;
}

export interface ClipProcessorLoopStartMessageRx {
	readonly type: "loopStart";
	readonly data: number;
}

export interface ClipProcessorLoopEndMessageRx {
	readonly type: "loopEnd";
	readonly data: number;
}

export interface ClipProcessorPlayheadMessageRx {
	readonly type: "playhead";
	readonly data: number;
}

export interface ClipProcessorFadeInMessageRx {
	readonly type: "fadeIn";
	readonly data: number;
}

export interface ClipProcessorFadeOutMessageRx {
	readonly type: "fadeOut";
	readonly data: number;
}

export interface ClipProcessorLoopCrossfadeMessageRx {
	readonly type: "loopCrossfade";
	readonly data: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const State = {
	Initial: 0,
	Started: 1,
	Stopped: 2,
	Paused: 3,
	Scheduled: 4,
	Ended: 5,
	Disposed: 6,
} as const;

// ---------------------------------------------------------------------------
// Default properties
// ---------------------------------------------------------------------------

function getProperties(
	opts: ClipProcessorOptions = {},
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
		enableHighpass,
		enableLowpass,
		enableGain,
		enablePan,
		enableDetune,
		enablePlaybackRate,
		enableLoopCrossfade,
	};
}

function setOffset(
	properties: Required<ClipProcessorOptions>,
	offset: number | undefined,
): number {
	if (offset === undefined) {
		properties.offset = 0;
		return 0;
	}
	if (offset < 0) {
		return setOffset(properties, (properties.buffer[0]?.length ?? 0) + offset);
	}
	if (offset > (properties.buffer[0]?.length ?? 1) - 1) {
		return setOffset(properties, (properties.buffer[0]?.length ?? 0) % offset);
	}
	const offs = Math.floor(offset * sampleRate);
	properties.offset = offs;
	return offs;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

const SAMPLE_BLOCK_SIZE = 128;

class ClipProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: "playbackRate",
				automationRate: "a-rate" as const,
				defaultValue: 1.0,
			},
			{ name: "detune", automationRate: "a-rate" as const, defaultValue: 0 },
			{
				name: "gain",
				automationRate: "a-rate" as const,
				defaultValue: 1,
				minValue: 0,
			},
			{ name: "pan", automationRate: "a-rate" as const, defaultValue: 0 },
			{
				name: "highpass",
				automationRate: "a-rate" as const,
				defaultValue: 20,
				minValue: 20,
				maxValue: 20000,
			},
			{
				name: "lowpass",
				automationRate: "a-rate" as const,
				defaultValue: 20000,
				minValue: 20,
				maxValue: 20000,
			},
		];
	}

	properties: Required<ClipProcessorOptions>;
	private lastFrameTime = 0;

	constructor(options?: ProcessorWorkletOptions) {
		super(options);
		this.properties = getProperties(options?.processorOptions);
		this.port.onmessage = this.onmessage;
	}

	private onmessage = (ev: MessageEvent) => {
		const { type, data } = ev.data;
		switch (type) {
			case "buffer":
				this.properties.buffer = data;
				break;
			case "start":
				this.properties.timesLooped = 0;
				this.properties.loopStart ??= 0;
				this.properties.loopEnd ??=
					(this.properties.buffer[0]?.length ?? 0) / sampleRate;
				this.properties.duration = data?.duration ?? -1;
				if (this.properties.duration === -1) {
					this.properties.duration = this.properties.loop
						? Number.MAX_SAFE_INTEGER
						: (this.properties.buffer[0]?.length ?? 0) / sampleRate;
				}
				setOffset(this.properties, data?.offset);
				this.properties.playhead = this.properties.offset;
				this.properties.startWhen = data?.when ?? currentTime;
				this.properties.stopWhen =
					this.properties.startWhen + this.properties.duration;
				this.properties.playedSamples = 0;
				this.properties.state = State.Scheduled;
				this.port.postMessage({ type: "scheduled" });
				break;
			case "stop":
				if (
					this.properties.state === State.Ended ||
					this.properties.state === State.Initial
				)
					break;
				this.properties.stopWhen = data ?? this.properties.stopWhen;
				this.properties.state = State.Stopped;
				this.port.postMessage({ type: "stopped" });
				break;
			case "pause":
				this.properties.state = State.Paused;
				this.properties.pauseWhen = data ?? currentTime;
				this.port.postMessage({ type: "paused" });
				break;
			case "resume":
				this.properties.state = State.Started;
				this.properties.startWhen = data ?? currentTime;
				this.port.postMessage({ type: "resume" });
				break;
			case "dispose":
				this.dispose();
				break;
			case "loop": {
				const loop = data as boolean;
				const st = this.properties.state;
				if (loop && (st === State.Scheduled || st === State.Started)) {
					this.properties.stopWhen = Number.MAX_SAFE_INTEGER;
					this.properties.duration = Number.MAX_SAFE_INTEGER;
				}
				this.properties.loop = loop;
				break;
			}
			case "loopStart":
				this.properties.loopStart = data;
				break;
			case "loopEnd":
				this.properties.loopEnd = data;
				break;
			case "loopCrossfade":
				this.properties.loopCrossfade = data;
				break;
			case "playhead":
				this.properties.playhead = Math.floor(data);
				break;
			case "fadeIn":
				this.properties.fadeInDuration = data;
				break;
			case "fadeOut":
				this.properties.fadeOutDuration = data;
				break;
			case "toggleGain":
				this.properties.enableGain = data ?? !this.properties.enableGain;
				break;
			case "togglePan":
				this.properties.enablePan = data ?? !this.properties.enablePan;
				break;
			case "toggleLowpass":
				this.properties.enableLowpass = data ?? !this.properties.enableLowpass;
				break;
			case "toggleHighpass":
				this.properties.enableHighpass =
					data ?? !this.properties.enableHighpass;
				break;
			case "toggleDetune":
				this.properties.enableDetune = data ?? !this.properties.enableDetune;
				break;
			case "togglePlaybackRate":
				this.properties.enablePlaybackRate =
					data ?? !this.properties.enablePlaybackRate;
				break;
			case "toggleFadeIn":
				this.properties.enableFadeIn = data ?? !this.properties.enableFadeIn;
				break;
			case "toggleFadeOut":
				this.properties.enableFadeOut = data ?? !this.properties.enableFadeOut;
				break;
			case "toggleLoopCrossfade":
				this.properties.enableLoopCrossfade =
					data ?? !this.properties.enableLoopCrossfade;
				break;
			case "logState":
				console.log(this.properties);
				break;
		}
	};

	private dispose() {
		this.properties.state = State.Disposed;
		this.port.postMessage({ type: "disposed" });
		this.port.close();
		this.properties.buffer = [];
	}

	process(
		_inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean {
		try {
			let state = this.properties.state;
			if (state === State.Disposed) return false;

			const ondone = (): boolean => {
				const timeTaken = currentTime - this.lastFrameTime;
				this.lastFrameTime = currentTime;
				this.port.postMessage({
					type: "frame",
					data: [
						currentTime,
						currentFrame,
						Math.floor(this.properties.playhead),
						timeTaken * 1000,
					],
				});
				return true;
			};

			if (state === State.Initial) return ondone();

			if (state === State.Ended) {
				fillWithSilence(outputs[0]);
				return ondone();
			}

			if (state === State.Scheduled) {
				if (currentTime >= this.properties.startWhen) {
					state = this.properties.state = State.Started;
					this.port.postMessage({ type: "started" });
				} else {
					fillWithSilence(outputs[0]);
					return ondone();
				}
			} else if (state === State.Paused) {
				if (currentTime > this.properties.pauseWhen) {
					fillWithSilence(outputs[0]);
					return ondone();
				}
			}

			if (currentTime > this.properties.stopWhen) {
				fillWithSilence(outputs[0]);
				this.properties.state = State.Ended;
				this.port.postMessage({ type: "ended" });
				this.properties.playedSamples = 0;
				return ondone();
			}

			const output0 = outputs[0];
			const sourceLength = this.properties.buffer[0]?.length ?? 0;
			if (sourceLength === 0) {
				fillWithSilence(output0);
				return ondone();
			}

			const {
				playbackRate: playbackRates,
				detune: _detunes,
				lowpass,
				highpass,
				gain: gains,
				pan: pans,
			} = parameters;

			const props = this.properties;
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
				enableFadeOut,
				enableFadeIn,
				enableLoopCrossfade,
				playhead,
				fadeInDuration,
				fadeOutDuration,
			} = props;

			const nc = Math.min(buffer.length, output0.length);
			const _ns = Math.min(buffer[0]?.length ?? 0, output0[0]?.length ?? 0);
			const durationSamples = props.duration * sampleRate;

			const loopCrossfadeSamples = Math.floor(sampleRate * loopCrossfade);
			const loopStartSamples = Math.min(
				Math.floor(loopStart * sampleRate),
				sourceLength - SAMPLE_BLOCK_SIZE,
			);
			const loopEndSamples = Math.min(
				Math.floor(loopEnd * sampleRate),
				sourceLength,
			);
			const loopLengthSamples = loopEndSamples - loopStartSamples;

			const blockParams: BlockParameters = {
				bufferLength: sourceLength,
				loop,
				playhead,
				loopStartSamples,
				loopEndSamples,
				durationSamples,
				playbackRates,
			};

			const {
				indexes,
				ended,
				looped,
				playhead: updatedPlayhead,
			} = props.enablePlaybackRate
				? findIndexesWithPlaybackRates(blockParams)
				: findIndexesNormal(blockParams);

			fill(output0, buffer, indexes);

			// --- Loop crossfade ---
			const xfadeNumSamples = Math.min(
				Math.floor(loopCrossfade * sampleRate),
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
				const fadeInSamples = Math.floor(fadeInDuration * sampleRate);
				const remaining = fadeInSamples - playedSamples;
				if (remaining > 0) {
					const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
					const doubleFadeInSamples = fadeInSamples * 2;
					for (let i = 0; i < n; i++) {
						const g = Math.cos(
							(Math.PI * (remaining - i)) / doubleFadeInSamples,
						);
						for (let ch = 0; ch < nc; ch++) {
							output0[ch][i] *= g;
						}
					}
				}
			}

			// --- Fade out ---
			if (enableFadeOut && fadeOutDuration > 0) {
				const fadeOutSamples = Math.floor(fadeOutDuration * sampleRate);
				const remainingDuration = stopWhen - currentTime;
				const remainingSamples = Math.floor(sampleRate * remainingDuration);
				if (remainingSamples < fadeOutSamples) {
					const remaining = fadeOutSamples - remainingSamples;
					const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
					const doubleFadeOutSamples = fadeOutSamples * 2;
					for (let i = 0; i < n; i++) {
						const g = Math.sin(
							(Math.PI * (remaining - i)) / doubleFadeOutSamples,
						);
						for (let ch = 0; ch < nc; ch++) {
							output0[ch][i] *= g;
						}
					}
				}
			}

			// --- Filters ---
			if (enableLowpass) lowpassFilter(output0, lowpass);
			if (enableHighpass) highpassFilter(output0, highpass);
			if (enableGain) gainFilter(output0, gains);
			if (nc === 1) monoToStereo(output0);
			if (enablePan) panFilter(output0, pans);

			if (looped) {
				props.timesLooped++;
				this.port.postMessage({ type: "looped", data: props.timesLooped });
			}
			if (ended) {
				props.state = State.Ended;
				this.port.postMessage({ type: "ended" });
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
				return true;
			}

			for (let i = 1; i < outputs.length; i++) {
				copy(output0, outputs[i]);
			}
			return ondone();
		} catch (e) {
			console.log(e);
			return true;
		}
	}
}

// ---------------------------------------------------------------------------
// Index calculation
// ---------------------------------------------------------------------------

function findIndexesNormal(p: BlockParameters): BlockReturnState {
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

function findIndexesWithPlaybackRates(p: BlockParameters): BlockReturnState {
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
// DSP Helpers
// ---------------------------------------------------------------------------

function fill(
	target: Float32Array[],
	source: Float32Array[],
	indexes: number[],
) {
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

function fillWithSilence(buffer: Float32Array[]) {
	for (let ch = 0; ch < buffer.length; ch++) {
		for (let j = 0; j < buffer[ch].length; j++) {
			buffer[ch][j] = 0;
		}
	}
}

function monoToStereo(signal: Float32Array[]) {
	const r = new Float32Array(signal[0].length);
	for (let i = 0; i < signal[0].length; i++) {
		r[i] = signal[0][i];
	}
	signal.push(r);
}

function copy(source: Float32Array[], target: Float32Array[]) {
	for (let i = target.length; i < source.length; i++) {
		target[i] = new Float32Array(source[i].length);
	}
	for (let ch = 0; ch < source.length; ch++) {
		for (let i = 0; i < source[ch].length; i++) {
			target[ch][i] = source[ch][i];
		}
	}
}

function checkNans(output0: Float32Array[]): number {
	let numNans = 0;
	for (let ch = 0; ch < output0.length; ch++) {
		for (let j = 0; j < output0[ch].length; j++) {
			if (Number.isNaN(output0[ch][j])) {
				numNans++;
				output0[ch][j] = 0;
			}
		}
	}
	return numNans;
}

function gainFilter(arr: Float32Array[], gains: Float32Array) {
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

// --- Filter state ---
const lowpassStates = [
	{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
	{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
];

function lowpassFilter(buffer: Float32Array[], cutoffs: Float32Array) {
	for (let channel = 0; channel < buffer.length; channel++) {
		const arr = buffer[channel];
		let { x_1, x_2, y_1, y_2 } = lowpassStates[channel] ?? {
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
		lowpassStates[channel] = { x_1, x_2, y_1, y_2 };
	}
}

const highpassStates = [
	{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
	{ x_1: 0, x_2: 0, y_1: 0, y_2: 0 },
];

function highpassFilter(buffer: Float32Array[], cutoffs: Float32Array) {
	for (let channel = 0; channel < buffer.length; channel++) {
		const arr = buffer[channel];
		let { x_1, x_2, y_1, y_2 } = highpassStates[channel] ?? {
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
		highpassStates[channel] = { x_1, x_2, y_1, y_2 };
	}
}

function panFilter(signal: Float32Array[], pans: Float32Array) {
	let pan = pans[0];
	for (let i = 0; i < signal[0].length; i++) {
		pan = pans[i] ?? pan;
		const leftGain = pan <= 0 ? 1 : 1 - pan;
		const rightGain = pan >= 0 ? 1 : 1 + pan;
		signal[0][i] *= leftGain;
		signal[1][i] *= rightGain;
	}
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

registerProcessor("ClipProcessor", ClipProcessor);
