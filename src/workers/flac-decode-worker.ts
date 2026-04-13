// FLAC Decode Worker — runs fetch → FLAC demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import {
	concat,
	createThrottleStream,
	estimateTotalSamplesFromContentLength,
	resampleChannel,
} from "./worker-utils";

// ── FLAC metadata parser ─────────────────────────────────────────────

const FLAC_MAGIC = [0x66, 0x4c, 0x61, 0x43] as const; // "fLaC"

export interface FlacMetadata {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	totalSamples: number;
	descriptionBytes: Uint8Array;
	audioDataOffset: number;
}

/**
 * Parse FLAC stream metadata from the start of a buffer.
 * Returns null if the buffer is too small or invalid.
 */
export function parseFlacMetadata(buf: Uint8Array): FlacMetadata | null {
	// Need at least 4 (magic) + 4 (block header) + 34 (STREAMINFO) = 42
	if (buf.length < 42) return null;

	// Validate "fLaC" magic
	for (let i = 0; i < 4; i++) {
		if (buf[i] !== FLAC_MAGIC[i]) return null;
	}

	// First metadata block must be STREAMINFO (type 0)
	const firstBlockHeader = buf[4];
	const firstBlockType = firstBlockHeader & 0x7f;
	if (firstBlockType !== 0) return null;

	const firstBlockLength = (buf[5] << 16) | (buf[6] << 8) | buf[7];
	if (firstBlockLength < 34) return null;
	if (buf.length < 8 + firstBlockLength) return null;

	// Parse STREAMINFO (starts at byte 8)
	const si = 8; // STREAMINFO data offset

	// Bits 80-99: sample rate (20 bits) — bytes 10-12 of STREAMINFO
	const sampleRate =
		(buf[si + 10] << 12) | (buf[si + 11] << 4) | (buf[si + 12] >> 4);
	if (sampleRate === 0) return null;

	// Bits 100-102: channels minus 1 (3 bits) — lower 4 bits of byte 12
	const channels = ((buf[si + 12] & 0x0e) >> 1) + 1;

	// Bits 103-107: bits per sample minus 1 (5 bits) — spans bytes 12-13
	const bitsPerSample =
		(((buf[si + 12] & 0x01) << 4) | (buf[si + 13] >> 4)) + 1;

	// Bits 108-143: total samples (36 bits) — lower 4 bits of byte 13 + bytes 14-17
	const totalSamples =
		((buf[si + 13] & 0x0f) * 0x100000000 +
			((buf[si + 14] << 24) |
				(buf[si + 15] << 16) |
				(buf[si + 16] << 8) |
				buf[si + 17])) >>>
		0;

	// Skip all metadata blocks to find audio data offset
	let offset = 4; // after "fLaC"
	let isLast = false;
	while (!isLast && offset + 4 <= buf.length) {
		const header = buf[offset];
		isLast = (header & 0x80) !== 0;
		const blockLength =
			(buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
		offset += 4 + blockLength;
		if (offset > buf.length) return null; // incomplete metadata
	}

	if (!isLast) return null; // didn't find the last metadata block

	// description = everything from "fLaC" through end of metadata
	const descriptionBytes = new Uint8Array(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + offset),
	);

	return {
		sampleRate,
		channels,
		bitsPerSample,
		totalSamples,
		descriptionBytes,
		audioDataOffset: offset,
	};
}

// ── FLAC frame boundary detection (sync-to-sync scanning) ────────────

export interface FlacFrameResult {
	frames: Uint8Array[];
	leftover: Uint8Array;
}

/**
 * Find FLAC frame boundaries by scanning for sync codes (0xFFF8 or 0xFFF9).
 * Uses simple sync-to-sync scanning (Option B from spec).
 */
export function findFlacFrames(buf: Uint8Array): FlacFrameResult {
	const frames: Uint8Array[] = [];
	const syncPositions: number[] = [];

	// Find all sync code positions
	for (let i = 0; i <= buf.length - 2; i++) {
		if (buf[i] === 0xff && (buf[i + 1] === 0xf8 || buf[i + 1] === 0xf9)) {
			syncPositions.push(i);
		}
	}

	if (syncPositions.length === 0) {
		return { frames: [], leftover: toOwned(buf) };
	}

	// Each frame = bytes from one sync code to the next
	for (let i = 0; i < syncPositions.length - 1; i++) {
		const start = syncPositions[i];
		const end = syncPositions[i + 1];
		frames.push(toOwned(buf.subarray(start, end)));
	}

	// Leftover = from last sync code to end of buffer
	const lastSync = syncPositions[syncPositions.length - 1];
	const leftover = toOwned(buf.subarray(lastSync));

	return { frames, leftover };
}

function toOwned(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	);
}

// ── Worker entry point ───────────────────────────────────────────────

let abortController: AbortController | null = null;

self.onmessage = (ev: MessageEvent) => {
	const { type } = ev.data;
	if (type === "init") {
		const { port, url, throttle, targetSampleRate } = ev.data as {
			port: MessagePort;
			url: string;
			throttle?: number;
			targetSampleRate?: number;
		};
		abortController = new AbortController();
		startStreaming(
			port,
			url,
			abortController.signal,
			throttle ?? 0,
			targetSampleRate ?? 0,
		);
	} else if (type === "abort") {
		abortController?.abort();
	}
};

async function startStreaming(
	processorPort: MessagePort,
	url: string,
	signal: AbortSignal,
	throttle: number,
	targetSampleRate: number,
) {
	let totalBytes: number | null = null;
	let bytesReceived = 0;
	let samplesDecoded = 0;
	let initialized = false;
	let didSendMeta = false;
	let streamSampleRate = 44100;
	let timestampUs = 0;

	const decoder = new AudioDecoder({
		output(audioData: AudioData) {
			const numFrames = audioData.numberOfFrames;
			const numChannels = audioData.numberOfChannels;
			const srcRate = audioData.sampleRate;
			const dstRate = targetSampleRate > 0 ? targetSampleRate : srcRate;

			const channelData: Float32Array[] = [];
			for (let ch = 0; ch < numChannels; ch++) {
				const raw = new Float32Array(numFrames);
				audioData.copyTo(raw, { planeIndex: ch, format: "f32-planar" });
				channelData.push(resampleChannel(raw, srcRate, dstRate));
			}
			audioData.close();

			const resampledFrames = channelData[0]?.length ?? 0;

			if (!didSendMeta) {
				didSendMeta = true;
				const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
					totalBytes,
					bitrate: null,
					sourceSampleRate: streamSampleRate,
					targetSampleRate: dstRate,
				});
				self.postMessage({
					type: "streamMeta",
					estimatedTotalSamples,
					sampleRate: dstRate,
					channels: numChannels,
					isEstimate: true,
				});
			}

			if (!initialized) {
				initialized = true;
				const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
					totalBytes,
					bitrate: null,
					sourceSampleRate: streamSampleRate,
					targetSampleRate: dstRate,
				});
				processorPort.postMessage({
					type: "bufferInit",
					data: {
						channels: numChannels,
						totalLength: estimatedTotalSamples ?? 0,
						streaming: true,
					},
				});
				self.postMessage({
					type: "info",
					sampleRate: srcRate,
					channels: numChannels,
				});
			}

			if (resampledFrames > 0) {
				processorPort.postMessage({
					type: "bufferRange",
					data: {
						startSample: samplesDecoded,
						channelData,
					},
				});
				samplesDecoded += resampledFrames;
				self.postMessage({ type: "decoded", samplesDecoded });
			}

			timestampUs += Math.round((numFrames / streamSampleRate) * 1_000_000);
		},
		error(e: DOMException) {
			self.postMessage({ type: "error", message: e.message });
		},
	});

	try {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			self.postMessage({
				type: "error",
				message: `Fetch failed: ${response.status} ${response.statusText}`,
			});
			return;
		}
		if (!response.body) {
			self.postMessage({ type: "error", message: "Response has no body" });
			return;
		}

		const contentLength = response.headers.get("content-length");
		totalBytes = contentLength ? Number.parseInt(contentLength, 10) : null;

		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();

		// Phase 1: Accumulate bytes until we have all metadata
		let accumulated: Uint8Array = new Uint8Array(0);
		let metadata: FlacMetadata | null = null;
		let leftover: Uint8Array = new Uint8Array(0);
		let configuredDecoder = false;
		let decodedAnyFrame = false;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			if (!metadata) {
				// Still accumulating metadata
				accumulated = concat(accumulated, value);
				metadata = parseFlacMetadata(accumulated);
				if (!metadata) continue;

				// Metadata parsed — configure decoder
				streamSampleRate = metadata.sampleRate;

				decoder.configure({
					codec: "flac",
					sampleRate: metadata.sampleRate,
					numberOfChannels: metadata.channels,
					description: metadata.descriptionBytes,
				});
				configuredDecoder = true;

				// If we know total samples, send exact estimate
				if (metadata.totalSamples > 0) {
					const dstRate =
						targetSampleRate > 0 ? targetSampleRate : metadata.sampleRate;
					const exactTotal = Math.round(
						(metadata.totalSamples / metadata.sampleRate) * dstRate,
					);
					self.postMessage({
						type: "streamMeta",
						estimatedTotalSamples: exactTotal,
						sampleRate: dstRate,
						channels: metadata.channels,
						isEstimate: false,
					});
					didSendMeta = true;
				}

				// Audio data starts at audioDataOffset
				leftover = toOwned(accumulated.subarray(metadata.audioDataOffset));
				accumulated = new Uint8Array(0); // free memory
				continue;
			}

			// Phase 2: Find frame boundaries and decode
			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const result = findFlacFrames(combined);

			for (const frame of result.frames) {
				decoder.decode(
					new EncodedAudioChunk({
						type: "key",
						timestamp: timestampUs,
						data: frame,
					}),
				);
				decodedAnyFrame = true;
			}

			leftover = result.leftover;
		}

		// Flush remaining leftover as a final frame if it looks like one
		if (leftover.length > 2 && configuredDecoder) {
			if (
				leftover[0] === 0xff &&
				(leftover[1] === 0xf8 || leftover[1] === 0xf9)
			) {
				decoder.decode(
					new EncodedAudioChunk({
						type: "key",
						timestamp: timestampUs,
						data: leftover,
					}),
				);
				decodedAnyFrame = true;
			}
		}

		if (configuredDecoder && decodedAnyFrame) {
			await decoder.flush();
		} else {
			self.postMessage({
				type: "error",
				message: "No FLAC frames found in the stream",
			});
			return;
		}

		processorPort.postMessage({
			type: "bufferEnd",
			data: { totalSamples: samplesDecoded },
		});
		self.postMessage({ type: "done", totalSamples: samplesDecoded });
	} catch (err) {
		if (signal.aborted) return;
		const msg = err instanceof Error ? err.message : String(err);
		self.postMessage({ type: "error", message: msg });
	} finally {
		try {
			decoder.close();
		} catch {
			// Decoder may already be closed
		}
		self.close();
	}
}
