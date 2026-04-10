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
