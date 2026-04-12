// OGG Vorbis Decode Worker — runs fetch → OGG/Vorbis demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import {
	buildXiphExtradata,
	isVorbisStream,
	parseVorbisIdentification,
} from "./vorbis-utils";
import {
	concat,
	createThrottleStream,
	estimateTotalSamplesFromContentLength,
	resampleChannel,
} from "./worker-utils";

// ── OGG page parser (shared with ogg-opus-decode-worker) ─────────────

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

		// granulePosition: 8 bytes LE → bigint
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
	let leftover: Uint8Array = new Uint8Array(0);
	let pendingPacket: Uint8Array = new Uint8Array(0);
	let initialized = false;
	let didSendMeta = false;
	let packetIndex = 0;
	let activeSerial: number | null = null;
	let streamChannels = 2;
	let streamSampleRate = 44100;
	let timestampUs = 0;

	// Vorbis needs 3 header packets: identification, comment, setup
	let idHeader: Uint8Array | null = null;
	let commentHeader: Uint8Array | null = null;

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
		let configuredDecoder = false;
		let decodedAnyPacket = false;

		const handlePacket = (packet: Uint8Array) => {
			if (packet.length === 0) return;

			// Packet 0: Vorbis identification header
			if (packetIndex === 0) {
				if (!isVorbisStream(packet)) {
					throw new Error("Missing or invalid Vorbis identification header");
				}
				const info = parseVorbisIdentification(packet);
				if (!info) {
					throw new Error("Failed to parse Vorbis identification header");
				}
				streamChannels = info.channels;
				streamSampleRate = info.sampleRate;
				idHeader = packet.slice();
				packetIndex += 1;
				return;
			}

			// Packet 1: Vorbis comment header
			if (packetIndex === 1) {
				commentHeader = packet.slice();
				packetIndex += 1;
				return;
			}

			// Packet 2: Vorbis setup header → configure decoder
			if (packetIndex === 2) {
				if (!idHeader || !commentHeader) {
					throw new Error("Missing Vorbis header packets");
				}
				const description = buildXiphExtradata(idHeader, commentHeader, packet);
				decoder.configure({
					codec: "vorbis",
					sampleRate: streamSampleRate,
					numberOfChannels: streamChannels,
					description,
				});
				configuredDecoder = true;
				packetIndex += 1;
				return;
			}

			// Packets 3+: audio data
			if (!configuredDecoder) {
				throw new Error("Decoder is not configured for Vorbis stream");
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
				message: "No Vorbis packets found in the stream",
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
	}
}
