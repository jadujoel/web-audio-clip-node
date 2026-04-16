import "./polyfills";

// Re-export Result types for consumers
export type { Result, ResultAsync } from "neverthrow";
export { Coordinator } from "./audio/Coordinator";
export { processorCode } from "./audio/clip/code";
// Processor kernel (for advanced / testing)
export {
	createFilterState,
	getProperties,
	handleProcessorMessage,
	processBlock,
	SAMPLE_BLOCK_SIZE,
} from "./audio/clip/kernel";
// Core audio
export { ClipNode } from "./audio/clip/node";
export { StreamingClipNode } from "./audio/clip/streaming-node";
// Types
export type {
	AudioMetadata,
	BufferedRange,
	BufferRangeWrite,
	ClipNodeEvents,
	ClipNodeState,
	ClipProcessorOptions,
	ClipProcessorState,
	ClipProcessorToggleMessageType,
	ClipWorkletOptions,
	FrameData,
	GapPlaybackStrategy,
	LoopMode,
	StreamBufferSpan,
	StreamBufferState,
	StreamError,
	StreamErrorCode,
	StreamingClipNodeEvents,
	StreamPreload,
	StreamReadyState,
} from "./audio/clip/types";
export { State } from "./audio/clip/types";
export {
	getProcessorBlobUrl,
	getProcessorCdnUrl,
	getProcessorModuleUrl,
} from "./audio/clip/url";
export { duckProcessorCode } from "./audio/duck/code";
export type { DuckProcessorState } from "./audio/duck/kernel";
export {
	createDuckProcessorState,
	processDuckBlock,
} from "./audio/duck/kernel";
export type { DuckNodeOptions } from "./audio/duck/node";
export { DuckNode } from "./audio/duck/node";
export { getDuckProcessorBlobUrl } from "./audio/duck/url";
export type { MediaSessionOptions } from "./audio/media-session";
export { bindMediaSession } from "./audio/media-session";
export type { SliderPreset, TempoRelativeSnap } from "./audio/utils";
// Utils
export {
	audioBufferFromFloat32Array,
	dbFromLin,
	float32ArrayFromAudioBuffer,
	generateSnapPoints,
	getSnappedValue,
	getTempoSnapInterval,
	isTempoRelativeSnap,
	linFromDb,
	presets,
	remapTempoRelativeValue,
} from "./audio/utils";
export type { ControlDef, ControlKey } from "./controls/controlDefs";
// Controls
export {
	allDefs,
	buildDefaults,
	controlDefs,
	DEFAULT_TEMPO,
	loopControlDefs,
	paramDefs,
	SAMPLE_RATE,
} from "./controls/controlDefs";
export { formatTickLabel, formatValueText } from "./controls/formatValueText";
export type {
	LinkedControlPairDef,
	LinkedControlPairKey,
} from "./controls/linkedControlPairs";
export {
	buildLinkedControlPairDefaults,
	getActiveLinkedControls,
	getLinkedControlPairForControl,
	getLinkedControlUpdates,
	loopLinkedControlPairs,
	transportLinkedControlPairs,
} from "./controls/linkedControlPairs";
// Data
export { loadFromCache } from "./data/cache";
export type { StoredFile } from "./data/fileStore";
export { loadUploadedFile, saveUploadedFile } from "./data/fileStore";
export { getDefaultUrlForFormat } from "./streamFormat";
export * from "./streaming";
export {
	clampSeekTargetSamples,
	clampSeekTargetSeconds,
	estimateTotalSamplesFromContentLength,
	secondsFromSamples,
} from "./streamTimeline";
export { oggOpusWorkerCode } from "./workers/ogg-opus-worker-code";
export {
	createOggOpusWorkerFromBlob,
	createWorkerFromBlob,
	getWorkerCode,
} from "./workers/workerUrl";
