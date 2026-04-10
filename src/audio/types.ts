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

export interface ClipWorkletOptions extends AudioWorkletNodeOptions {
	processorOptions?: ClipProcessorOptions;
}

export type ClipNodeState =
	| "initial"
	| "scheduled"
	| "started"
	| "stopped"
	| "paused"
	| "resumed"
	| "ended"
	| "disposed";

export type FrameData = readonly [
	currentTime: number,
	currentFrame: number,
	playhead: number,
	timeTaken: number,
];

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
// Block parameters (used by kernel)
// ---------------------------------------------------------------------------

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
