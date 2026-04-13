// WebM Vorbis Decode Worker — runs fetch → WebM/Matroska demux → AudioDecoder off the main thread.
// Feeds Vorbis audio packets from WebM container into WebCodecs AudioDecoder.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { parseVorbisIdentification } from "./vorbis-utils";
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

// ── Minimal EBML/WebM parser for Vorbis extraction ──────────────────

type ElementType = "m" | "u" | "s" | "b";

interface ElementDetail {
	name: string;
	type: ElementType;
	isEnd?: boolean;
	value?: number | string;
	data: Uint8Array;
}

interface PartialTrackInfo {
	trackNumber?: number;
	trackType?: number;
	codecId?: string;
	codecPrivate?: Uint8Array | null;
	channels?: number;
	sampleRate?: number;
}

interface VorbisTrackInfo {
	trackNumber: number;
	channels: number;
	sampleRate: number;
	codecPrivate: Uint8Array; // Xiph extradata
}

interface StackEntry {
	name: string;
	end: number | null;
}

interface ParserState {
	timestampScaleNs: number;
	clusterTimestamp: number;
	currentTrack: PartialTrackInfo | null;
	activeTrack: VorbisTrackInfo | null;
	inAudio: boolean;
	buffer: Uint8Array;
	byteOffset: number;
	elementStack: StackEntry[];
}

interface ParsedPacket {
	packet: Uint8Array;
	timestampUs: number;
}

interface ParseResult {
	packets: ParsedPacket[];
	track: VorbisTrackInfo | null;
}

const EMPTY = new Uint8Array(0);
const ASCII = new TextDecoder("ascii");

// SampleRate element ID for Audio child
const WEBM_ELEMENTS = new Map<number, { name: string; type: ElementType }>([
	[0x1a45dfa3, { name: "EBML", type: "m" }],
	[0x18538067, { name: "Segment", type: "m" }],
	[0x114d9b74, { name: "SeekHead", type: "m" }],
	[0x1549a966, { name: "Info", type: "m" }],
	[0x1654ae6b, { name: "Tracks", type: "m" }],
	[0x1f43b675, { name: "Cluster", type: "m" }],
	[0x1c53bb6b, { name: "Cues", type: "m" }],
	[0xae, { name: "TrackEntry", type: "m" }],
	[0xe1, { name: "Audio", type: "m" }],
	[0x2ad7b1, { name: "TimestampScale", type: "u" }],
	[0xe7, { name: "Timestamp", type: "u" }],
	[0xd7, { name: "TrackNumber", type: "u" }],
	[0x83, { name: "TrackType", type: "u" }],
	[0x86, { name: "CodecID", type: "s" }],
	[0x63a2, { name: "CodecPrivate", type: "b" }],
	[0x9f, { name: "Channels", type: "u" }],
	[0xb5, { name: "SamplingFrequency", type: "b" }], // float — handled manually
	[0xa3, { name: "SimpleBlock", type: "b" }],
	[0xa1, { name: "Block", type: "b" }],
]);

function readEbmlId(
	buf: Uint8Array,
	offset: number,
): { length: number; value: number } | null {
	if (offset >= buf.length) return null;
	const first = buf[offset];
	if (first === 0) return null;
	let length = 1;
	while (length <= 4 && (first & (1 << (8 - length))) === 0) length++;
	if (length > 4 || offset + length > buf.length) return null;
	let value = 0;
	for (let i = 0; i < length; i++)
		value = (value << 8) | (buf[offset + i] ?? 0);
	return { length, value };
}

function readVint(
	buf: Uint8Array,
	offset: number,
	signed = false,
): { length: number; value: number } | null {
	if (offset >= buf.length) return null;
	const first = buf[offset];
	if (first === 0) return null;
	let length = 1;
	while (length <= 8 && (first & (1 << (8 - length))) === 0) length++;
	if (length > 8 || offset + length > buf.length) return null;
	let value = first & ((1 << (8 - length)) - 1);
	for (let i = 1; i < length; i++) value = value * 256 + (buf[offset + i] ?? 0);
	const maxValue = 2 ** (7 * length) - 1;
	if (!signed && value === maxValue) return { length, value: -1 };
	if (signed) value -= 2 ** (7 * length - 1) - 1;
	return { length, value };
}

function readUnsigned(buf: Uint8Array): number {
	let v = 0;
	for (const b of buf) v = v * 256 + b;
	return v;
}

function readFloat(buf: Uint8Array): number {
	if (buf.length === 4) {
		return new DataView(buf.buffer, buf.byteOffset, 4).getFloat32(0, false);
	}
	if (buf.length === 8) {
		return new DataView(buf.buffer, buf.byteOffset, 8).getFloat64(0, false);
	}
	return 0;
}

function toOwned(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	);
}

function createParserState(): ParserState {
	return {
		timestampScaleNs: 1_000_000,
		clusterTimestamp: 0,
		currentTrack: null,
		activeTrack: null,
		inAudio: false,
		buffer: EMPTY,
		byteOffset: 0,
		elementStack: [],
	};
}

function parseBlockFrames(payload: Uint8Array, lacing: number): Uint8Array[] {
	if (lacing === 0) return [toOwned(payload)];
	if (payload.length === 0) return [];
	let cursor = 0;
	const frameCount = (payload[cursor++] ?? 0) + 1;
	const sizes: number[] = [];

	if (lacing === 2) {
		const size = Math.floor((payload.length - cursor) / frameCount);
		return Array.from({ length: frameCount }, (_, i) =>
			toOwned(payload.subarray(cursor + i * size, cursor + (i + 1) * size)),
		);
	}
	if (lacing === 1) {
		let total = 0;
		for (let i = 0; i < frameCount - 1; i++) {
			let size = 0;
			while (cursor < payload.length) {
				const v = payload[cursor++] ?? 0;
				size += v;
				if (v !== 0xff) break;
			}
			sizes.push(size);
			total += size;
		}
		sizes.push(payload.length - cursor - total);
	} else {
		const first = readVint(payload, cursor, false);
		if (!first) return [];
		cursor += first.length;
		sizes.push(first.value);
		let total = first.value;
		for (let i = 1; i < frameCount - 1; i++) {
			const delta = readVint(payload, cursor, true);
			if (!delta) return [];
			cursor += delta.length;
			const next = (sizes[i - 1] ?? 0) + delta.value;
			sizes.push(next);
			total += next;
		}
		sizes.push(payload.length - cursor - total);
	}

	const frames: Uint8Array[] = [];
	for (const size of sizes) {
		frames.push(toOwned(payload.subarray(cursor, cursor + size)));
		cursor += size;
	}
	return frames;
}

function parseBlock(data: Uint8Array): {
	trackNumber: number;
	timecode: number;
	frames: Uint8Array[];
} {
	const track = readVint(data, 0, false);
	if (!track) throw new Error("Invalid WebM block: missing track number");
	let cursor = track.length;
	if (data.length < cursor + 3)
		throw new Error("Invalid WebM block: truncated header");
	let timecode = ((data[cursor] ?? 0) << 8) | (data[cursor + 1] ?? 0);
	if (timecode & 0x8000) timecode -= 0x10000;
	cursor += 2;
	const flags = data[cursor++] ?? 0;
	const lacing = (flags >> 1) & 0x03;
	return {
		trackNumber: track.value,
		timecode,
		frames: parseBlockFrames(data.subarray(cursor), lacing),
	};
}

function drainCompletedMasters(
	state: ParserState,
	absoluteOffset: number,
	elements: ElementDetail[],
) {
	while (state.elementStack.length > 0) {
		const top = state.elementStack[state.elementStack.length - 1];
		if (!top || top.end == null || absoluteOffset < top.end) break;
		state.elementStack.pop();
		elements.push({ name: top.name, type: "m", isEnd: true, data: EMPTY });
	}
}

function parseEbmlElements(
	chunk: Uint8Array,
	state: ParserState,
): ElementDetail[] {
	state.buffer = state.buffer.length > 0 ? concat(state.buffer, chunk) : chunk;
	const elements: ElementDetail[] = [];
	let cursor = 0;

	while (true) {
		drainCompletedMasters(state, state.byteOffset + cursor, elements);
		const id = readEbmlId(state.buffer, cursor);
		if (!id) break;
		const size = readVint(state.buffer, cursor + id.length, false);
		if (!size) break;
		const headerSize = id.length + size.length;
		if (state.buffer.length < cursor + headerSize) break;

		const info = WEBM_ELEMENTS.get(id.value) ?? {
			name: "unknown",
			type: "b" as const,
		};
		const dataSize = size.value;
		const contentStart = state.byteOffset + cursor + headerSize;
		cursor += headerSize;

		if (info.type === "m") {
			elements.push({ name: info.name, type: "m", isEnd: false, data: EMPTY });
			const end = dataSize >= 0 ? contentStart + dataSize : null;
			state.elementStack.push({ name: info.name, end });
			continue;
		}

		if (dataSize < 0 || cursor + dataSize > state.buffer.length) break;
		const raw = state.buffer.subarray(cursor, cursor + dataSize);
		cursor += dataSize;

		if (info.type === "u") {
			elements.push({
				name: info.name,
				type: info.type,
				value: readUnsigned(raw),
				data: toOwned(raw),
			});
		} else if (info.type === "s") {
			elements.push({
				name: info.name,
				type: info.type,
				value: ASCII.decode(raw),
				data: toOwned(raw),
			});
		} else {
			elements.push({ name: info.name, type: info.type, data: toOwned(raw) });
		}
	}

	drainCompletedMasters(state, state.byteOffset + cursor, elements);
	if (cursor > 0) {
		state.buffer =
			state.buffer.length > cursor
				? toOwned(state.buffer.subarray(cursor))
				: EMPTY;
		state.byteOffset += cursor;
	}
	return elements;
}

function processElements(
	elements: ElementDetail[],
	state: ParserState,
): ParseResult {
	const packets: ParsedPacket[] = [];
	let track: VorbisTrackInfo | null = null;

	for (const el of elements) {
		if (el.type === "m") {
			if (!el.isEnd) {
				if (el.name === "TrackEntry") state.currentTrack = {};
				else if (el.name === "Audio") state.inAudio = true;
			} else {
				if (el.name === "TrackEntry") {
					if (
						state.activeTrack == null &&
						state.currentTrack?.trackType === 2 &&
						state.currentTrack.codecId === "A_VORBIS" &&
						state.currentTrack.trackNumber != null &&
						state.currentTrack.codecPrivate
					) {
						// Parse Vorbis ID header from CodecPrivate (Xiph extradata)
						const cp = state.currentTrack.codecPrivate;
						const idHeader = extractFirstXiphPacket(cp);
						const info = idHeader ? parseVorbisIdentification(idHeader) : null;
						if (info) {
							state.activeTrack = {
								trackNumber: state.currentTrack.trackNumber,
								channels: info.channels,
								sampleRate: info.sampleRate,
								codecPrivate: cp,
							};
							track = state.activeTrack;
						}
					}
					state.currentTrack = null;
				} else if (el.name === "Audio") {
					state.inAudio = false;
				}
			}
			continue;
		}

		if (el.name === "TimestampScale") {
			state.timestampScaleNs = el.value as number;
			continue;
		}
		if (el.name === "Timestamp") {
			state.clusterTimestamp = el.value as number;
			continue;
		}

		if (state.currentTrack != null) {
			if (el.name === "TrackNumber")
				state.currentTrack.trackNumber = el.value as number;
			else if (el.name === "TrackType")
				state.currentTrack.trackType = el.value as number;
			else if (el.name === "CodecID")
				state.currentTrack.codecId = el.value as string;
			else if (el.name === "CodecPrivate")
				state.currentTrack.codecPrivate = el.data;
			else if (el.name === "Channels" && state.inAudio)
				state.currentTrack.channels = el.value as number;
			else if (el.name === "SamplingFrequency" && state.inAudio) {
				state.currentTrack.sampleRate = readFloat(el.data);
			}
			continue;
		}

		if (
			state.activeTrack != null &&
			(el.name === "SimpleBlock" || el.name === "Block")
		) {
			const block = parseBlock(el.data);
			if (block.trackNumber !== state.activeTrack.trackNumber) continue;
			const baseTimestampUs = Math.max(
				0,
				Math.round(
					((state.clusterTimestamp + block.timecode) * state.timestampScaleNs) /
						1_000,
				),
			);
			for (let i = 0; i < block.frames.length; i++) {
				packets.push({
					packet: block.frames[i],
					timestampUs: baseTimestampUs + i,
				});
			}
		}
	}

	return { packets, track };
}

/** Extract the first Vorbis header packet from Xiph extradata format. */
function extractFirstXiphPacket(data: Uint8Array): Uint8Array | null {
	if (data.length < 3) return null;
	const numPacketsMinus1 = data[0];
	if (numPacketsMinus1 < 2) return null; // Vorbis needs exactly 3 packets (value = 2)
	let cursor = 1;
	// Read Xiph-laced size of first packet
	let size1 = 0;
	while (cursor < data.length && data[cursor] === 255) {
		size1 += 255;
		cursor++;
	}
	if (cursor >= data.length) return null;
	size1 += data[cursor];
	cursor++;
	// Skip size of second packet (advance cursor past Xiph lacing)
	while (cursor < data.length && data[cursor] === 255) {
		cursor++;
	}
	if (cursor >= data.length) return null;
	cursor++; // skip the final lacing byte
	// First packet starts at cursor
	if (cursor + size1 > data.length) return null;
	return data.slice(cursor, cursor + size1);
}

// ── Worker entry point ───────────────────────────────────────────────

let abortController: AbortController | null = null;
const gate = new BackpressureGate();
let currentPort: MessagePort | null = null;
let currentUrl = "";
let currentThrottle = 0;
let currentTargetSampleRate = 0;
let currentRetryConfig: StreamRetryConfig = DEFAULT_RETRY_CONFIG;
// Cached codec config for seek (Vorbis needs CodecPrivate from WebM header)
let cachedCodecConfig: {
	sampleRate: number;
	channels: number;
	codecPrivate: Uint8Array;
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
	let streamChannels = 2;
	let streamSampleRate = 44100;

	const parserState = createParserState();

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
					format: "WebmVorbis",
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
					format: "WebmVorbis",
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
				codec: "vorbis",
				sampleRate: cachedCodecConfig.sampleRate,
				numberOfChannels: cachedCodecConfig.channels,
				description: cachedCodecConfig.codecPrivate,
			});
			configuredDecoder = true;
			streamChannels = cachedCodecConfig.channels;
			streamSampleRate = cachedCodecConfig.sampleRate;
		}

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const elements = parseEbmlElements(value, parserState);
			const parsed = processElements(elements, parserState);

			if (parsed.track != null && !configuredDecoder) {
				streamChannels = parsed.track.channels;
				streamSampleRate = parsed.track.sampleRate;
				// CodecPrivate for Vorbis in WebM is already Xiph extradata format
				decoder.configure({
					codec: "vorbis",
					sampleRate: streamSampleRate,
					numberOfChannels: streamChannels,
					description: parsed.track.codecPrivate,
				});
				cachedCodecConfig = {
					sampleRate: streamSampleRate,
					channels: streamChannels,
					codecPrivate: new Uint8Array(parsed.track.codecPrivate),
				};
				configuredDecoder = true;
			}

			for (const pkt of parsed.packets) {
				if (!configuredDecoder) continue;
				decoder.decode(
					new EncodedAudioChunk({
						type: "key",
						timestamp: pkt.timestampUs,
						data: pkt.packet,
					}),
				);
				decodedAnyPacket = true;
			}
		}

		if (configuredDecoder && decodedAnyPacket) {
			await decoder.flush();
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No WebM Vorbis packets found in the stream",
			});
			return;
		}

		processorPort.postMessage({
			type: "bufferEnd",
			data: { totalLength: samplesDecoded },
		});

		self.postMessage({
			type: "done",
			samplesDecoded,
			sampleRate: streamSampleRate,
			channels: streamChannels,
		});
	} catch (e: unknown) {
		if (e instanceof DOMException && e.name === "AbortError") {
			self.postMessage({ type: "aborted" });
		} else {
			self.postMessage({
				type: "error",
				code: "DECODE",
				message: e instanceof Error ? e.message : String(e),
			});
		}
	} finally {
		try {
			decoder.close();
		} catch {
			// already closed
		}
		processorPort.close();
		self.close();
	}
}
