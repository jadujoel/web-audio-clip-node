import { estimateTotalSamplesFromContentLength } from "../streamTimeline";

export { estimateTotalSamplesFromContentLength };

export type StreamErrorCode =
	| "NETWORK"
	| "DECODE"
	| "FORMAT_UNSUPPORTED"
	| "ABORTED";

export function postError(code: StreamErrorCode, message: string): void {
	self.postMessage({ type: "error", code, message });
}

export function classifyFetchError(err: unknown): StreamErrorCode {
	if (err instanceof DOMException && err.name === "AbortError")
		return "ABORTED";
	return "NETWORK";
}

/**
 * A gate that can pause and resume an async loop.
 * Call `await gate.wait()` at the top of a fetch loop to block when paused.
 */
export class BackpressureGate {
	private _paused = false;
	private _resolve: (() => void) | null = null;

	get paused(): boolean {
		return this._paused;
	}

	pause(): void {
		this._paused = true;
	}

	resume(): void {
		this._paused = false;
		if (this._resolve) {
			this._resolve();
			this._resolve = null;
		}
	}

	/** Returns immediately if not paused; blocks until resume() otherwise. */
	wait(): Promise<void> | void {
		if (!this._paused) return;
		return new Promise<void>((resolve) => {
			this._resolve = resolve;
		});
	}
}

export interface StreamRetryConfig {
	maxRetries: number;
	retryDelayMs: number;
	backoffMultiplier: number;
	maxRetryDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: StreamRetryConfig = {
	maxRetries: 3,
	retryDelayMs: 1000,
	backoffMultiplier: 2,
	maxRetryDelayMs: 30_000,
};

/**
 * Fetch with automatic retry and exponential backoff.
 * Posts `{ type: "retry", attempt, delay, error }` to the main thread on each retry.
 */
export async function fetchWithRetry(
	url: string,
	signal: AbortSignal,
	config: StreamRetryConfig | null,
	bytesReceived = 0,
): Promise<Response> {
	const maxRetries = config?.maxRetries ?? 0;
	let delay = config?.retryDelayMs ?? 1000;
	const backoff = config?.backoffMultiplier ?? 2;
	const maxDelay = config?.maxRetryDelayMs ?? 30_000;

	let attempt = 0;

	while (true) {
		try {
			const headers: HeadersInit = {};
			if (bytesReceived > 0) {
				headers.Range = `bytes=${bytesReceived}-`;
			}
			const response = await fetch(url, { signal, headers });
			if (!response.ok && response.status !== 206) {
				throw new Error(
					`Fetch failed: ${response.status} ${response.statusText}`,
				);
			}
			return response;
		} catch (err) {
			if (signal.aborted) throw err;
			attempt++;
			if (attempt > maxRetries) throw err;

			const errMsg =
				err instanceof Error ? err.message : "Unknown network error";
			self.postMessage({ type: "retry", attempt, delay, error: errMsg });
			await new Promise((r) => setTimeout(r, delay));
			delay = Math.min(delay * backoff, maxDelay);
		}
	}
}

/**
 * Parse total byte size from a response, handling both normal and Range (206) responses.
 * For 206 responses, extracts total from Content-Range header (`bytes X-Y/TOTAL`).
 */
export function parseTotalBytes(
	response: Response,
	byteOffset = 0,
): number | null {
	const contentLength = response.headers.get("content-length");
	if (response.status === 206) {
		const contentRange = response.headers.get("content-range");
		const totalMatch = contentRange?.match(/\/(\d+)/);
		if (totalMatch) return Number.parseInt(totalMatch[1], 10);
		return contentLength
			? byteOffset + Number.parseInt(contentLength, 10)
			: null;
	}
	return contentLength ? Number.parseInt(contentLength, 10) : null;
}

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

export type PcmChannelData = Float32Array;

export function float32ToInt16(src: Float32Array): Int16Array {
	const out = new Int16Array(src.length);
	for (let i = 0; i < src.length; i++) {
		const clamped = Math.max(-1, Math.min(1, src[i] ?? 0));
		out[i] =
			clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
	}
	return out;
}

/** @deprecated useInt16 is deprecated and has no effect. Float32 is always used for transfer. */
export function maybeConvertToInt16(
	channelData: Float32Array[],
	useInt16: boolean,
): Float32Array[] {
	if (useInt16) {
		console.warn(
			"useInt16 is deprecated and has no effect. Float32 is always used for transfer to avoid audio-thread GC.",
		);
	}
	return channelData;
}

export function postBufferRange(
	port: MessagePort,
	startSample: number,
	channelData: Float32Array[],
): void {
	const transferables = channelData.map((channel) => channel.buffer);
	port.postMessage(
		{
			type: "bufferRange",
			data: {
				startSample,
				channelData,
			},
		},
		transferables,
	);
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

// ---------------------------------------------------------------------------
// Frame batching — reduces postMessage frequency from ~50/sec to ~24/sec
// ---------------------------------------------------------------------------

/** Default batch threshold: 2048 samples (~43ms at 48kHz). */
export const FRAME_BATCH_THRESHOLD_SAMPLES = 2048;

function concatFrames(frames: Float32Array[][]): Float32Array[] {
	const channels = frames[0]?.length ?? 0;
	const result: Float32Array[] = [];
	for (let ch = 0; ch < channels; ch++) {
		let totalLen = 0;
		for (const frame of frames) totalLen += frame[ch]?.length ?? 0;
		const merged = new Float32Array(totalLen);
		let offset = 0;
		for (const frame of frames) {
			const src = frame[ch];
			if (src !== undefined) {
				merged.set(src, offset);
				offset += src.length;
			}
		}
		result.push(merged);
	}
	return result;
}

/**
 * Batches decoded audio frames and flushes when a sample threshold is reached.
 * Reduces postMessage frequency and GC pressure on the audio render thread.
 */
export class FrameBatcher {
	private frames: Float32Array[][] = [];
	private sampleCount = 0;

	constructor(
		private readonly thresholdSamples: number = FRAME_BATCH_THRESHOLD_SAMPLES,
	) {}

	/**
	 * Add a decoded frame. Returns a concatenated batch if the threshold is met,
	 * or null if more frames are needed.
	 */
	add(channelData: Float32Array[]): Float32Array[] | null {
		this.frames.push(channelData);
		this.sampleCount += channelData[0]?.length ?? 0;
		if (this.sampleCount >= this.thresholdSamples) {
			return this.flush();
		}
		return null;
	}

	/** Flush any buffered frames regardless of threshold. Returns null if empty. */
	flush(): Float32Array[] | null {
		if (this.frames.length === 0) return null;
		const result = concatFrames(this.frames);
		this.frames = [];
		this.sampleCount = 0;
		return result;
	}

	get bufferedSamples(): number {
		return this.sampleCount;
	}
}

/**
 * Post a decodedRange message to the main thread so it can track buffered
 * regions without involving the audio render thread.
 */
export function postDecodedRange(startSample: number, endSample: number): void {
	self.postMessage({ type: "decodedRange", startSample, endSample });
}
