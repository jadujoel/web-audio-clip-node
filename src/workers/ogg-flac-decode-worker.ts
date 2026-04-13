// OGG FLAC Decode Worker — runs fetch → OGG/FLAC demux → AudioDecoder off the main thread.
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
	fetchWithRetry,
	parseTotalBytes,
	resampleChannel,
	type StreamRetryConfig,
} from "./worker-utils";

// ── OGG FLAC identification header parser ────────────────────────────

const OGG_FLAC_MAGIC = [0x7f, 0x46, 0x4c, 0x41, 0x43] as const; // "\x7FFLAC"

export interface OggFlacInfo {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	totalSamples: number;
	numberOfHeaderPackets: number;
	descriptionBytes: Uint8Array;
}

/**
 * Check if the first OGG packet indicates a FLAC stream.
 * OGG FLAC identification header starts with 0x7F, "FLAC".
 */
export function isFlacStream(firstPacket: Uint8Array): boolean {
	if (firstPacket.length < 5) return false;
	for (let i = 0; i < 5; i++) {
		if (firstPacket[i] !== OGG_FLAC_MAGIC[i]) return false;
	}
	return true;
}

/**
 * Parse the OGG FLAC identification header (packet 0, minimum 51 bytes).
 * Returns null if the packet is too short or has invalid format.
 *
 * Layout:
 *   Byte 0:       0x7F
 *   Bytes 1-4:    "FLAC"
 *   Byte 5:       major version
 *   Byte 6:       minor version
 *   Bytes 7-8:    number of header packets (big-endian u16)
 *   Bytes 9-12:   "fLaC" (native FLAC magic)
 *   Bytes 13-16:  METADATA_BLOCK_HEADER for STREAMINFO
 *   Bytes 17-50:  STREAMINFO (34 bytes)
 */
export function parseOggFlacHeader(packet: Uint8Array): OggFlacInfo | null {
	if (packet.length < 51) return null;

	// Validate magic
	for (let i = 0; i < 5; i++) {
		if (packet[i] !== OGG_FLAC_MAGIC[i]) return null;
	}

	// Number of header packets (big-endian u16, bytes 7-8)
	const numberOfHeaderPackets = (packet[7] << 8) | packet[8];

	// Validate "fLaC" at bytes 9-12
	if (
		packet[9] !== 0x66 ||
		packet[10] !== 0x4c ||
		packet[11] !== 0x61 ||
		packet[12] !== 0x43
	) {
		return null;
	}

	// STREAMINFO starts at byte 17 (after 4-byte block header at 13-16)
	const si = 17;

	// Sample rate: 20 bits at STREAMINFO offset 10
	const sampleRate =
		(packet[si + 10] << 12) | (packet[si + 11] << 4) | (packet[si + 12] >> 4);
	if (sampleRate === 0) return null;

	// Channels: 3 bits + 1
	const channels = ((packet[si + 12] & 0x0e) >> 1) + 1;

	// Bits per sample: 5 bits + 1
	const bitsPerSample =
		(((packet[si + 12] & 0x01) << 4) | (packet[si + 13] >> 4)) + 1;

	// Total samples: 36 bits
	const totalSamples =
		(packet[si + 13] & 0x0f) * 0x100000000 +
		(((packet[si + 14] << 24) |
			(packet[si + 15] << 16) |
			(packet[si + 16] << 8) |
			packet[si + 17]) >>>
			0);

	// description = bytes 9 onward: "fLaC" + STREAMINFO metadata block (4+4+34 = 42 bytes)
	const descriptionBytes = new Uint8Array(
		packet.buffer.slice(packet.byteOffset + 9, packet.byteOffset + 9 + 42),
	);

	return {
		sampleRate,
		channels,
		bitsPerSample,
		totalSamples,
		numberOfHeaderPackets,
		descriptionBytes,
	};
}

// ── OGG page parser ──────────────────────────────────────────────────

const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53] as const;

interface OggPage {
	headerType: number;
	granulePosition: bigint;
	serialNumber: number;
	pageSequence: number;
	packets: Uint8Array[];
	continued: boolean;
	lastPacketComplete: boolean;
}

interface OggParseResult {
	pages: OggPage[];
	leftover: Uint8Array;
}

function indexOfOggSync(buf: Uint8Array, from: number): number {
	for (let i = from; i <= buf.length - OGG_MAGIC.length; i++) {
		if (
			buf[i] === OGG_MAGIC[0] &&
			buf[i + 1] === OGG_MAGIC[1] &&
			buf[i + 2] === OGG_MAGIC[2] &&
			buf[i + 3] === OGG_MAGIC[3]
		) {
			return i;
		}
	}
	return -1;
}

function parseOggPages(buf: Uint8Array): OggParseResult {
	const pages: OggPage[] = [];
	let cursor = 0;

	while (cursor < buf.length) {
		const sync = indexOfOggSync(buf, cursor);
		if (sync < 0) break;
		if (sync > cursor) cursor = sync;
		if (cursor + 27 > buf.length) break;

		const version = buf[cursor + 4] ?? 255;
		if (version !== 0) {
			cursor += 1;
			continue;
		}

		const headerType = buf[cursor + 5] ?? 0;

		let granulePosition = 0n;
		for (let i = 0; i < 8; i++) {
			granulePosition |= BigInt(buf[cursor + 6 + i] ?? 0) << BigInt(i * 8);
		}

		const serialNumber =
			(buf[cursor + 14] ?? 0) |
			((buf[cursor + 15] ?? 0) << 8) |
			((buf[cursor + 16] ?? 0) << 16) |
			((buf[cursor + 17] ?? 0) << 24);
		const pageSequence =
			(buf[cursor + 18] ?? 0) |
			((buf[cursor + 19] ?? 0) << 8) |
			((buf[cursor + 20] ?? 0) << 16) |
			((buf[cursor + 21] ?? 0) << 24);
		const segmentCount = buf[cursor + 26] ?? 0;
		const segmentTableStart = cursor + 27;
		const segmentTableEnd = segmentTableStart + segmentCount;
		if (segmentTableEnd > buf.length) break;

		let segmentBytes = 0;
		for (let i = 0; i < segmentCount; i++) {
			segmentBytes += buf[segmentTableStart + i] ?? 0;
		}

		const segmentDataStart = segmentTableEnd;
		const segmentDataEnd = segmentDataStart + segmentBytes;
		if (segmentDataEnd > buf.length) break;

		const packets: Uint8Array[] = [];
		let packetStart = segmentDataStart;
		let packetSize = 0;
		for (let i = 0; i < segmentCount; i++) {
			const lace = buf[segmentTableStart + i] ?? 0;
			packetSize += lace;
			if (lace < 255) {
				packets.push(buf.slice(packetStart, packetStart + packetSize));
				packetStart += packetSize;
				packetSize = 0;
			}
		}

		const lastPacketComplete = packetSize === 0;
		if (!lastPacketComplete) {
			packets.push(buf.slice(packetStart, packetStart + packetSize));
		}

		pages.push({
			headerType,
			granulePosition,
			serialNumber,
			pageSequence,
			packets,
			continued: (headerType & 0x01) !== 0,
			lastPacketComplete,
		});

		cursor = segmentDataEnd;
	}

	return { pages, leftover: buf.slice(cursor) };
}

// ── Worker entry point ───────────────────────────────────────────────

let abortController: AbortController | null = null;
const gate = new BackpressureGate();
let currentPort: MessagePort | null = null;
let currentUrl = "";
let currentThrottle = 0;
let currentTargetSampleRate = 0;
let currentRetryConfig: StreamRetryConfig = DEFAULT_RETRY_CONFIG;
// Cached codec config for seek (FLAC needs header packet to configure)
let cachedCodecConfig: {
	sampleRate: number;
	channels: number;
	description: Uint8Array;
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
	let leftover: Uint8Array = new Uint8Array(0);
	let pendingPacket: Uint8Array = new Uint8Array(0);
	let initialized = isSeeking;
	let didSendMeta = isSeeking;
	let didSignalSeeked = !isSeeking;
	let packetIndex = 0;
	let activeSerial: number | null = null;
	let streamSampleRate = 44100;
	let timestampUs = isSeeking
		? Math.round((sampleOffset / 48_000) * 1_000_000)
		: 0;

	// OGG FLAC header info
	let headerPacketsRemaining = 0;

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
					format: "OggFlac",
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
					format: "OggFlac",
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

				if (!didSignalSeeked) {
					didSignalSeeked = true;
					self.postMessage({ type: "seeked", sampleOffset: samplesDecoded });
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
		let configuredDecoder = false;
		let decodedAnyPacket = false;

		// When seeking, use cached codec config to configure decoder immediately
		if (isSeeking && cachedCodecConfig) {
			decoder.configure({
				codec: "flac",
				sampleRate: cachedCodecConfig.sampleRate,
				numberOfChannels: cachedCodecConfig.channels,
				description: cachedCodecConfig.description,
			});
			configuredDecoder = true;
			streamSampleRate = cachedCodecConfig.sampleRate;
		}

		const handlePacket = (packet: Uint8Array) => {
			if (packet.length === 0) return;

			// Packet 0: OGG FLAC identification header
			if (packetIndex === 0) {
				if (!isFlacStream(packet)) {
					throw new Error("Missing or invalid OGG FLAC identification header");
				}
				const info = parseOggFlacHeader(packet);
				if (!info) {
					throw new Error("Failed to parse OGG FLAC identification header");
				}
				streamSampleRate = info.sampleRate;
				headerPacketsRemaining = info.numberOfHeaderPackets;

				decoder.configure({
					codec: "flac",
					sampleRate: info.sampleRate,
					numberOfChannels: info.channels,
					description: info.descriptionBytes,
				});
				cachedCodecConfig = {
					sampleRate: info.sampleRate,
					channels: info.channels,
					description: info.descriptionBytes,
				};
				configuredDecoder = true;

				// If we know total samples, send exact estimate
				if (info.totalSamples > 0) {
					const dstRate =
						targetSampleRate > 0 ? targetSampleRate : info.sampleRate;
					const exactTotal = Math.round(
						(info.totalSamples / info.sampleRate) * dstRate,
					);
					self.postMessage({
						type: "streamMeta",
						estimatedTotalSamples: exactTotal,
						sampleRate: dstRate,
						channels: info.channels,
						isEstimate: false,
					});
					didSendMeta = true;
				}

				packetIndex += 1;
				return;
			}

			// Packets 1..N: Header metadata packets
			if (headerPacketsRemaining > 0) {
				headerPacketsRemaining -= 1;
				// Check for VORBIS_COMMENT block (type 4)
				if (packet.length > 4) {
					const blockType = packet[0] & 0x7f;
					if (blockType === 4) {
						const metadata = parseVorbisComment(packet.subarray(4));
						if (metadata) {
							metadata.codec = "flac";
							self.postMessage({ type: "metadata", metadata });
						}
					}
				}
				packetIndex += 1;
				return;
			}

			// Audio packets: complete FLAC frames
			if (!configuredDecoder) {
				throw new Error("Decoder is not configured for FLAC stream");
			}
			decoder.decode(
				new EncodedAudioChunk({
					type: "key",
					timestamp: timestampUs,
					data: packet,
				}),
			);
			decodedAnyPacket = true;
			packetIndex += 1;
		};

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const parsed = parseOggPages(combined);
			leftover = parsed.leftover;

			for (const page of parsed.pages) {
				if (activeSerial == null) {
					activeSerial = page.serialNumber;
				}
				if (page.serialNumber !== activeSerial) continue;

				if (page.continued) {
					if (page.packets.length === 0) continue;
					pendingPacket = concat(pendingPacket, page.packets[0]);
					const firstComplete =
						page.packets.length > 1 || page.lastPacketComplete;
					if (firstComplete) {
						handlePacket(pendingPacket);
						pendingPacket = new Uint8Array(0);
					}
					for (let i = 1; i < page.packets.length; i++) {
						const isTrailingPartial =
							i === page.packets.length - 1 && !page.lastPacketComplete;
						if (isTrailingPartial) {
							pendingPacket = concat(pendingPacket, page.packets[i]);
							continue;
						}
						if (pendingPacket.length > 0) {
							handlePacket(concat(pendingPacket, page.packets[i]));
							pendingPacket = new Uint8Array(0);
						} else {
							handlePacket(page.packets[i]);
						}
					}
					continue;
				}

				for (let i = 0; i < page.packets.length; i++) {
					const isTrailingPartial =
						i === page.packets.length - 1 && !page.lastPacketComplete;
					if (isTrailingPartial) {
						pendingPacket = concat(pendingPacket, page.packets[i]);
						continue;
					}
					if (pendingPacket.length > 0) {
						handlePacket(concat(pendingPacket, page.packets[i]));
						pendingPacket = new Uint8Array(0);
					} else {
						handlePacket(page.packets[i]);
					}
				}
			}
		}

		if (pendingPacket.length > 0) {
			handlePacket(pendingPacket);
			pendingPacket = new Uint8Array(0);
		}

		if (configuredDecoder && decodedAnyPacket) {
			await decoder.flush();
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No FLAC audio packets found in OGG stream",
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
