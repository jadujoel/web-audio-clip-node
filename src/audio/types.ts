export const State = {
	Initial: 0,
	Started: 1,
	Stopped: 2,
	Paused: 3,
	Scheduled: 4,
	Ended: 5,
	Disposed: 6,
} as const;

export type ClipProcessorState = (typeof State)[keyof typeof State];

// ---------------------------------------------------------------------------
// Streaming error types
// ---------------------------------------------------------------------------

export type StreamErrorCode =
	| "NETWORK"
	| "DECODE"
	| "FORMAT_UNSUPPORTED"
	| "ABORTED";

export interface StreamError {
	code: StreamErrorCode;
	message: string;
}

// ---------------------------------------------------------------------------
// Audio metadata
// ---------------------------------------------------------------------------

export interface AudioMetadata {
	title?: string;
	artist?: string;
	album?: string;
	trackNumber?: number;
	year?: number;
	genre?: string;
	duration?: number;
	sampleRate?: number;
	channels?: number;
	bitrate?: number;
	codec?: string;
	picture?: {
		data: ArrayBuffer;
		mimeType: string;
	};
}

export interface ClipProcessorOptions {
	buffer?: Float32Array[];
	streamBuffer?: StreamBufferState;
	loop?: boolean;
	loopMode?: LoopMode;
	loopStart?: number;
	loopEnd?: number;
	loopCrossfade?: number;
	loopCrossfadeOffset?: number;
	offset?: number;
	duration?: number;
	playhead?: number;
	playbackDirection?: 1 | -1;
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
	enableLoopStart?: boolean;
	enableLoopEnd?: boolean;
	enableLoopCrossfade?: boolean;
	enableGain?: boolean;
	enablePan?: boolean;
	enableHighpass?: boolean;
	enableLowpass?: boolean;
	enableDetune?: boolean;
	enablePlaybackRate?: boolean;
	enableFrameReporting?: boolean;
	muted?: boolean;
}

export interface ClipWorkletOptions extends AudioWorkletNodeOptions {
	processorOptions?: ClipProcessorOptions;
}

export type LoopMode = "forward" | "boomerang";

export type ClipNodeState =
	| "initial"
	| "scheduled"
	| "started"
	| "stopped"
	| "paused"
	| "resumed"
	| "ended"
	| "disposed";

export type StreamReadyState =
	| "empty"
	| "loading"
	| "canplay"
	| "canplaythrough"
	| "complete";

export type StreamPreload = "none" | "metadata" | "auto";

// ---------------------------------------------------------------------------
// Event maps for on()/off() support
// ---------------------------------------------------------------------------

export interface ClipNodeEventMap {
	scheduled: [];
	started: [];
	paused: [];
	resumed: [];
	ended: [];
	looped: [];
	stopped: [];
	frame: [FrameData];
	disposed: [];
	statechange: [ClipNodeState];
	durationchange: [number];
	ratechange: [number];
	timeupdate: [number];
	seeking: [];
	seeked: [];
}

export interface StreamingClipNodeEventMap extends ClipNodeEventMap {
	error: [StreamError];
	progress: [number];
	done: [];
	bufferchange: [BufferedRange[]];
	waiting: [];
	canplay: [];
	canplaythrough: [];
	loadstart: [];
	readystatechange: [StreamReadyState];
	retry: [attempt: number, delay: number, error: string];
	metadata: [AudioMetadata];
}

export interface BufferedRange {
	start: number;
	end: number;
}

export type FrameData = readonly [
	currentTime: number,
	currentFrame: number,
	playhead: number,
	timeTaken: number,
];

export type ClipProcessorToggleMessageType =
	| "toggleFadeIn"
	| "toggleFadeOut"
	| "toggleLoopStart"
	| "toggleLoopEnd"
	| "toggleLoopCrossfade"
	| "toggleGain"
	| "togglePan"
	| "toggleHighpass"
	| "toggleLowpass"
	| "toggleDetune"
	| "togglePlaybackRate";

// ---------------------------------------------------------------------------
// Processor message types (moved from processor.ts)
// ---------------------------------------------------------------------------

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

export type ClipProcessorMessageRx =
	| ClipProcessorBufferMessageRx
	| ClipProcessorBufferInitMessageRx
	| ClipProcessorBufferRangeMessageRx
	| ClipProcessorBufferEndMessageRx
	| ClipProcessorBufferResetMessageRx
	| ClipProcessorStartMessageRx
	| ClipProcessorStopMessageRx
	| ClipProcessorPauseMessageRx
	| ClipProcessorResumeMessageRx
	| ClipProcessorDisposeMessageRx
	| ClipProcessorLoopMessageRx
	| ClipProcessorLoopModeMessageRx
	| ClipProcessorLoopStartMessageRx
	| ClipProcessorLoopEndMessageRx
	| ClipProcessorPlayheadMessageRx
	| ClipProcessorFadeInMessageRx
	| ClipProcessorFadeOutMessageRx
	| ClipProcessorLoopCrossfadeMessageRx
	| ClipProcessorLoopCrossfadeOffsetMessageRx
	| ClipProcessorToggleMessageRx
	| ClipProcessorLogStateMessageRx
	| ClipProcessorEnableFrameReportingMessageRx
	| ClipProcessorMuteMessageRx;

export type ClipProcessorMessageType =
	| "buffer"
	| "bufferInit"
	| "bufferRange"
	| "bufferEnd"
	| "bufferReset"
	| "start"
	| "stop"
	| "pause"
	| "resume"
	| "dispose"
	| "loop"
	| "loopMode"
	| "loopStart"
	| "loopEnd"
	| "playhead"
	| "playbackRate"
	| "offset"
	| "fadeIn"
	| "fadeOut"
	| "loopCrossfade"
	| "loopCrossfadeOffset"
	| ClipProcessorToggleMessageType
	| "logState"
	| "enableFrameReporting";

export interface ClipProcessorLogStateMessageRx {
	readonly type: "logState";
	readonly data?: never;
}

export interface ClipProcessorEnableFrameReportingMessageRx {
	readonly type: "enableFrameReporting";
	readonly data: boolean;
}

export interface ClipProcessorMuteMessageRx {
	readonly type: "mute";
	readonly data: boolean;
}

export interface ClipProcessorToggleMessageRx {
	readonly type: ClipProcessorToggleMessageType;
	readonly data?: boolean;
}

export interface ClipProcessorBufferMessageRx {
	readonly type: "buffer";
	readonly data: Float32Array[];
}

export interface StreamBufferSpan {
	startSample: number;
	endSample: number;
}

export interface BufferRangeWrite {
	readonly startSample: number;
	readonly channelData: Array<Float32Array>;
	readonly totalLength?: number | null;
	readonly streamEnded?: boolean;
}

export interface StreamBufferState {
	totalLength: number | null;
	committedLength: number;
	endRequested: boolean;
	streamEnded: boolean;
	streaming: boolean;
	/** True when streaming is active — prevents buffer reallocation during writes. */
	streamingActive: boolean;
	/** Furthest sample written into the buffer (may be beyond committedLength for sparse writes). */
	maxWrittenSample: number;
	/**
	 * Fixed-size ring (max 4) of non-sequential written spans, used to track
	 * seek-origin writes without array allocation in the hot path.
	 */
	seekSpans: StreamBufferSpan[];
	lowWaterThreshold: number;
	lowWaterNotified: boolean;
	lastUnderrunSample: number | null;
	/** True when the processor is outputting silence due to buffer underrun. */
	underrunActive: boolean;
	/** Number of samples to fade-in over when recovering from underrun. */
	underrunRecoverySamples: number;
	/** Current sample position within the recovery fade-in (0 = start). */
	underrunRecoveryPosition: number;
}

export interface ClipProcessorBufferInitMessageRx {
	readonly type: "bufferInit";
	readonly data: {
		readonly channels: number;
		readonly totalLength: number;
		readonly streaming?: boolean;
	};
}

export interface ClipProcessorBufferRangeMessageRx {
	readonly type: "bufferRange";
	readonly data: BufferRangeWrite;
}

export interface ClipProcessorBufferEndMessageRx {
	readonly type: "bufferEnd";
	readonly data?: {
		readonly totalLength?: number;
	};
}

export interface ClipProcessorBufferResetMessageRx {
	readonly type: "bufferReset";
	readonly data?: never;
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

export interface ClipProcessorLoopModeMessageRx {
	readonly type: "loopMode";
	readonly data: LoopMode;
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

export interface ClipProcessorLoopCrossfadeOffsetMessageRx {
	readonly type: "loopCrossfadeOffset";
	readonly data: number;
}

// ---------------------------------------------------------------------------
// Block parameters (used by kernel)
// ---------------------------------------------------------------------------

export interface BlockParameters {
	readonly playhead: number;
	readonly durationSamples: number;
	readonly loop: boolean;
	readonly loopMode?: LoopMode;
	readonly playbackDirection?: 1 | -1;
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
	readonly playbackDirection: 1 | -1;
}
