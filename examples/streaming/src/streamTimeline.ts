interface EstimateInput {
	totalBytes: number | null;
	bitrate: number | null;
	sourceSampleRate: number;
	targetSampleRate: number;
}

const FALLBACK_BITRATE_BPS = 128_000;

export function estimateTotalSamplesFromContentLength({
	totalBytes,
	bitrate,
	sourceSampleRate,
	targetSampleRate,
}: EstimateInput): number | null {
	if (totalBytes == null || totalBytes <= 0) return null;
	if (sourceSampleRate <= 0 || targetSampleRate <= 0) return null;
	const safeBitrate =
		bitrate != null && Number.isFinite(bitrate) && bitrate > 0
			? bitrate
			: FALLBACK_BITRATE_BPS;
	const durationSeconds = (totalBytes * 8) / safeBitrate;
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
	const totalSamples = Math.ceil(durationSeconds * targetSampleRate);
	return Number.isFinite(totalSamples) && totalSamples > 0 ? totalSamples : null;
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
