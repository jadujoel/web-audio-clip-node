import { SAMPLE_RATE } from "../controls/controlDefs";

interface StreamingPlayheadModelInput {
	value: number;
	audioDuration: number | null;
	seekableSamples: number | null;
	streamProgress: number;
}

export interface StreamingPlayheadModel {
	maxSamples: number;
	decodedRatio: number;
	decodedPercent: number;
}

function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value <= 0) return 0;
	if (value >= 1) return 1;
	return value;
}

function toSafeNonNegativeInt(value: number | null): number | null {
	if (value == null || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return Math.floor(value);
}

function maxSamplesFromDuration(audioDuration: number | null): number {
	if (
		audioDuration == null ||
		!Number.isFinite(audioDuration) ||
		audioDuration <= 0
	) {
		return 0;
	}
	return Math.max(0, Math.floor(audioDuration * SAMPLE_RATE));
}

export function buildStreamingPlayheadModel({
	value,
	audioDuration,
	seekableSamples,
	streamProgress,
}: StreamingPlayheadModelInput): StreamingPlayheadModel {
	const knownMaxSamples = maxSamplesFromDuration(audioDuration);
	const safeSeekable = toSafeNonNegativeInt(seekableSamples);
	const safeValue = toSafeNonNegativeInt(value) ?? 0;
	const maxSamples =
		knownMaxSamples > 0
			? knownMaxSamples
			: Math.max(0, safeValue, safeSeekable ?? 0);

	const decodedRatio =
		knownMaxSamples > 0 && safeSeekable != null
			? clampUnit(safeSeekable / knownMaxSamples)
			: clampUnit(streamProgress);

	return {
		maxSamples,
		decodedRatio,
		decodedPercent: Math.round(decodedRatio * 100),
	};
}
