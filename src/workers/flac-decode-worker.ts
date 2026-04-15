// FLAC Decode Worker — runs fetch → FLAC demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { parseVorbisComment } from "./vorbis-comment-parser";
import {
	BackpressureGate,
	concat,
	createThrottleStream,
	DEFAULT_RETRY_CONFIG,
	estimateTotalSamplesFromContentLength,
	FrameBatcher,
	fetchWithRetry,
	parseTotalBytes,
	postBufferRange,
	postDecodedRange,
	resampleChannel,
	type StreamRetryConfig,
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

/**
 * Find the VORBIS_COMMENT metadata block (type 4) in a FLAC buffer.
 * Returns the comment data (without the 4-byte block header), or null.
 */
export function findFlacVorbisComment(buf: Uint8Array): Uint8Array | null {
	if (buf.length < 8) return null;
	// Validate "fLaC" magic
	for (let i = 0; i < 4; i++) {
		if (buf[i] !== FLAC_MAGIC[i]) return null;
	}
	let offset = 4;
	while (offset + 4 <= buf.length) {
		const header = buf[offset];
		const isLast = (header & 0x80) !== 0;
		const blockType = header & 0x7f;
		const blockLength =
			(buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
		if (offset + 4 + blockLength > buf.length) return null;
		if (blockType === 4) {
			return buf.subarray(offset + 4, offset + 4 + blockLength);
		}
		offset += 4 + blockLength;
		if (isLast) break;
	}
	return null;
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
const gate = new BackpressureGate();
let currentPort: MessagePort | null = null;
let currentUrl = "";
let currentThrottle = 0;
let currentTargetSampleRate = 0;
let currentRetryConfig: StreamRetryConfig = DEFAULT_RETRY_CONFIG;
// Cached codec config for seek (FLAC needs metadata blocks to configure)
let cachedCodecConfig: {
	sampleRate: number;
	channels: number;
	description: Uint8Array;
	audioDataOffset: number;
} | null = null;

self.onmessage = (ev: MessageEvent) => {
	const { type } = ev.data;
	if (type === "init") {
		const { port, url, throttle, targetSampleRate, retry } = ev.data as {
			port: MessagePort;
			url: string;
			throttle?: number;
			targetSampleRate?: number;
			retry?: StreamRetryConfig | null;
		};
		currentPort = port;
		currentUrl = url;
		currentThrottle = throttle ?? 0;
		currentTargetSampleRate = targetSampleRate ?? 0;
		currentRetryConfig = retry ?? DEFAULT_RETRY_CONFIG;
		abortController = new AbortController();
		startStreaming(
			port,
			url,
			abortController.signal,
			currentThrottle,
			currentTargetSampleRate,
			currentRetryConfig,
			0,
			0,
		);
	} else if (type === "seek") {
		const { sampleOffset, byteOffset } = ev.data as {
			sampleOffset: number;
			byteOffset: number;
		};
		abortController?.abort();
		abortController = new AbortController();
		if (currentPort) {
			startStreaming(
				currentPort,
				currentUrl,
				abortController.signal,
				currentThrottle,
				currentTargetSampleRate,
				currentRetryConfig,
				byteOffset,
				sampleOffset,
			);
		}
	} else if (type === "pause-fetch") {
		gate.pause();
	} else if (type === "resume-fetch") {
		gate.resume();
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
	retryConfig: StreamRetryConfig,
	byteOffset = 0,
	sampleOffset = 0,
) {
	const isSeeking = byteOffset > 0;
	let totalBytes: number | null = null;
	let bytesReceived = 0;
	let samplesDecoded = sampleOffset;
	let initialized = isSeeking;
	let didSendMeta = isSeeking;
	let didSignalSeeked = !isSeeking;
	let streamSampleRate = 44100;
	const batcher = new FrameBatcher();
	let timestampUs = isSeeking
		? Math.round((sampleOffset / 48_000) * 1_000_000)
		: 0;

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
					format: "Flac",
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
					format: "Flac",
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
				samplesDecoded += resampledFrames;
				self.postMessage({ type: "decoded", samplesDecoded });
				const batch = batcher.add(channelData);
				if (batch !== null) {
					const batchStart = samplesDecoded - (batch[0]?.length ?? 0);
					postBufferRange(processorPort, batchStart, batch);
					postDecodedRange(batchStart, samplesDecoded);
				}

				if (!didSignalSeeked) {
					didSignalSeeked = true;
					self.postMessage({ type: "seeked", sampleOffset: samplesDecoded });
					const flushed = batcher.flush();
					if (flushed !== null && (flushed[0]?.length ?? 0) > 0) {
						const fSamples = flushed[0]?.length ?? 0;
						const fStart = samplesDecoded - fSamples;
						postBufferRange(processorPort, fStart, flushed);
						postDecodedRange(fStart, samplesDecoded);
					}
				}
			}

			timestampUs += Math.round((numFrames / streamSampleRate) * 1_000_000);
		},
		error(e: DOMException) {
			self.postMessage({ type: "error", code: "DECODE", message: e.message });
		},
	});

	try {
		const response = await fetchWithRetry(url, signal, retryConfig, byteOffset);
		if (!response.ok && response.status !== 206) {
			self.postMessage({
				type: "error",
				code: "NETWORK",
				message: `Fetch failed: ${response.status} ${response.statusText}`,
			});
			return;
		}
		if (!response.body) {
			self.postMessage({
				type: "error",
				code: "NETWORK",
				message: "Response has no body",
			});
			return;
		}

		totalBytes = parseTotalBytes(response, byteOffset);

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

		// When seeking, use cached codec config to skip metadata accumulation
		if (isSeeking && cachedCodecConfig) {
			decoder.configure({
				codec: "flac",
				sampleRate: cachedCodecConfig.sampleRate,
				numberOfChannels: cachedCodecConfig.channels,
				description: cachedCodecConfig.description,
			});
			configuredDecoder = true;
			streamSampleRate = cachedCodecConfig.sampleRate;
			metadata = {
				sampleRate: cachedCodecConfig.sampleRate,
				channels: cachedCodecConfig.channels,
				bitsPerSample: 16,
				totalSamples: 0,
				descriptionBytes: cachedCodecConfig.description,
				audioDataOffset: cachedCodecConfig.audioDataOffset,
			};
		}

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			if (!metadata) {
				// Still accumulating metadata
				accumulated = concat(accumulated, value);
				metadata = parseFlacMetadata(accumulated);
				if (!metadata) continue;

				// Extract Vorbis comment tags if present
				const commentBlock = findFlacVorbisComment(accumulated);
				if (commentBlock) {
					const audioMeta = parseVorbisComment(commentBlock);
					if (audioMeta) {
						audioMeta.codec = "flac";
						self.postMessage({ type: "metadata", metadata: audioMeta });
					}
				}

				// Metadata parsed — configure decoder
				streamSampleRate = metadata.sampleRate;

				decoder.configure({
					codec: "flac",
					sampleRate: metadata.sampleRate,
					numberOfChannels: metadata.channels,
					description: metadata.descriptionBytes,
				});
				cachedCodecConfig = {
					sampleRate: metadata.sampleRate,
					channels: metadata.channels,
					description: metadata.descriptionBytes,
					audioDataOffset: metadata.audioDataOffset,
				};
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
			const trailing = batcher.flush();
			if (trailing !== null && (trailing[0]?.length ?? 0) > 0) {
				const trailSamples = trailing[0]?.length ?? 0;
				const trailStart = samplesDecoded - trailSamples;
				postBufferRange(processorPort, trailStart, trailing);
				postDecodedRange(trailStart, samplesDecoded);
			}
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No FLAC frames found in the stream",
			});
			return;
		}

		processorPort.postMessage({
			type: "bufferEnd",
			data: { totalSamples: samplesDecoded },
		});
		self.postMessage({ type: "done", samplesDecoded });
	} catch (err) {
		if (signal.aborted) return;
		const msg = err instanceof Error ? err.message : String(err);
		self.postMessage({ type: "error", code: "DECODE", message: msg });
	} finally {
		try {
			decoder.close();
		} catch {
			// Decoder may already be closed
		}
		self.close();
	}
}
