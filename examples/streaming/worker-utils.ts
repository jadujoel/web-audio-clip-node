export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
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
