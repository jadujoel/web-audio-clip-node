export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

const FALLBACK_BITRATE_BPS = 128_000;

interface EstimateTotalSamplesInput {
	totalBytes: number | null;
	bitrate: number | null;
	sourceSampleRate: number;
	targetSampleRate: number;
}

export function estimateTotalSamplesFromContentLength({
	totalBytes,
	bitrate,
	sourceSampleRate,
	targetSampleRate,
}: EstimateTotalSamplesInput): number | null {
	if (totalBytes == null || totalBytes <= 0) return null;
	if (sourceSampleRate <= 0 || targetSampleRate <= 0) return null;
	const safeBitrate =
		bitrate != null && Number.isFinite(bitrate) && bitrate > 0
			? bitrate
			: FALLBACK_BITRATE_BPS;
	const durationSeconds = (totalBytes * 8) / safeBitrate;
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
	const totalSamples = Math.ceil(durationSeconds * targetSampleRate);
	return Number.isFinite(totalSamples) && totalSamples > 0
		? totalSamples
		: null;
}

export function resampleChannel(
	src: Float32Array,
	srcRate: number,
	dstRate: number,
): Float32Array {
	if (srcRate === dstRate) return src;
	const ratio = srcRate / dstRate;
	const dstLen = Math.round(src.length / ratio);
	const dst = new Float32Array(dstLen);
	for (let i = 0; i < dstLen; i++) {
		const srcPos = i * ratio;
		const idx = Math.floor(srcPos);
		const frac = srcPos - idx;
		const a = src[idx] ?? 0;
		const b = src[Math.min(idx + 1, src.length - 1)] ?? 0;
		dst[i] = a + frac * (b - a);
	}
	return dst;
}

export function createThrottleStream(
	bytesPerSec: number,
): TransformStream<Uint8Array, Uint8Array> {
	let totalBytes = 0;
	const startTime = performance.now();
	return new TransformStream({
		async transform(chunk, controller) {
			totalBytes += chunk.length;
			const elapsed = (performance.now() - startTime) / 1000;
			const expected = totalBytes / bytesPerSec;
			const delay = expected - elapsed;
			if (delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay * 1000));
			}
			controller.enqueue(chunk);
		},
	});
}
