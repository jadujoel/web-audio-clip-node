interface EstimateInput {
	totalBytes: number | null;
	bitrate: number | null;
	sourceSampleRate: number;
	targetSampleRate: number;
	/** Optional format hint for better default bitrate when bitrate is null. */
	format?: string;
}

const FALLBACK_BITRATE_BPS = 128_000;

/** Format-specific default bitrates (bits per second) for initial estimation. */
const FORMAT_DEFAULT_BITRATE: Record<string, number> = {
	Aac: 128_000,
	Flac: 800_000,
	Mp3: 192_000,
	Mp4Aac: 128_000,
	OggFlac: 800_000,
	OggOpus: 128_000,
	OggVorbis: 192_000,
	RawOpusFramed: 128_000,
	WebmOpus: 128_000,
	WebmVorbis: 192_000,
};

export function estimateTotalSamplesFromContentLength({
	totalBytes,
	bitrate,
	sourceSampleRate,
	targetSampleRate,
	format,
}: EstimateInput): number | null {
	if (totalBytes == null || totalBytes <= 0) return null;
	if (sourceSampleRate <= 0 || targetSampleRate <= 0) return null;
	const safeBitrate =
		bitrate != null && Number.isFinite(bitrate) && bitrate > 0
			? bitrate
			: (format && FORMAT_DEFAULT_BITRATE[format]) || FALLBACK_BITRATE_BPS;
	const durationSeconds = (totalBytes * 8) / safeBitrate;
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
	const totalSamples = Math.ceil(durationSeconds * targetSampleRate);
	return Number.isFinite(totalSamples) && totalSamples > 0
		? totalSamples
		: null;
}

export function secondsFromSamples(
	samples: number,
	sampleRate: number,
): number | null {
	if (!Number.isFinite(samples) || samples <= 0) return null;
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
	return samples / sampleRate;
}

export function clampSeekTargetSeconds(
	targetSeconds: number,
	seekableDurationSeconds: number | null,
): { value: number; clamped: boolean } {
	if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
		return { value: 0, clamped: true };
	}
	if (
		seekableDurationSeconds == null ||
		!Number.isFinite(seekableDurationSeconds) ||
		seekableDurationSeconds < 0
	) {
		return { value: targetSeconds, clamped: false };
	}
	if (targetSeconds <= seekableDurationSeconds) {
		return { value: targetSeconds, clamped: false };
	}
	return { value: seekableDurationSeconds, clamped: true };
}

export function clampSeekTargetSamples(
	targetSample: number,
	seekableSamples: number | null,
): { value: number; clamped: boolean } {
	const requested = Number.isFinite(targetSample)
		? Math.max(0, Math.floor(targetSample))
		: 0;
	if (
		seekableSamples == null ||
		!Number.isFinite(seekableSamples) ||
		seekableSamples < 0
	) {
		return { value: requested, clamped: false };
	}
	const clampedValue = Math.min(
		requested,
		Math.max(0, Math.floor(seekableSamples)),
	);
	return {
		value: clampedValue,
		clamped: clampedValue !== requested,
	};
}

/**
 * Estimate the byte offset for a given sample position.
 * Uses a simple linear proportion: `byteOffset = (sampleOffset / totalSamples) * totalBytes`.
 * Accurate for CBR formats; approximate for VBR.
 */
export function estimateByteOffsetFromSample({
	sampleOffset,
	totalSamples,
	totalBytes,
}: {
	sampleOffset: number;
	totalSamples: number;
	totalBytes: number;
}): number {
	if (
		totalSamples <= 0 ||
		totalBytes <= 0 ||
		!Number.isFinite(sampleOffset) ||
		sampleOffset <= 0
	) {
		return 0;
	}
	const ratio = Math.min(sampleOffset / totalSamples, 1);
	return Math.floor(ratio * totalBytes);
}
