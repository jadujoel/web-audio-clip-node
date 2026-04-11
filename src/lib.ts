// Core audio
export { ClipNode } from "./audio/ClipNode";
export { processorCode } from "./audio/processor-code";
// Processor kernel (for advanced / testing)
export {
	createFilterState,
	getProperties,
	handleProcessorMessage,
	processBlock,
	SAMPLE_BLOCK_SIZE,
} from "./audio/processor-kernel";

// Types
export type {
	BufferRangeWrite,
	ClipNodeState,
	ClipProcessorOptions,
	ClipProcessorState,
	ClipProcessorToggleMessageType,
	ClipWorkletOptions,
	FrameData,
	StreamBufferSpan,
	StreamBufferState,
} from "./audio/types";
export { State } from "./audio/types";
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
export {
	getProcessorBlobUrl,
	getProcessorCdnUrl,
	getProcessorModuleUrl,
} from "./audio/workletUrl";
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
