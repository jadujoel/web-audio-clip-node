// Raw Opus Decode Worker — runs fetch → framed raw Opus packet parse → AudioDecoder off the main thread.
// Expected transport format:
// - 8-byte magic: FROPUS01
// - 4-byte little-endian OpusHead packet length
// - OpusHead packet bytes
// - repeated 4-byte little-endian packet length + Opus packet bytes

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import {
	createFramedRawOpusStreamState,
	parseFramedRawOpusStream,
} from "./framed-raw-opus";
import { OPUS_SAMPLE_RATE, StreamingOpusDecoder } from "./opus-worker-common";
import {
	BackpressureGate,
	concat,
	createThrottleStream,
	DEFAULT_RETRY_CONFIG,
	fetchWithRetry,
	parseTotalBytes,
	type StreamRetryConfig,
} from "./worker-utils";

let abortController: AbortController | null = null;
const gate = new BackpressureGate();
let currentPort: MessagePort | null = null;
let currentUrl = "";
let currentThrottle = 0;
let currentTargetSampleRate = 0;
let currentRetryConfig: StreamRetryConfig = DEFAULT_RETRY_CONFIG;
// Cached codec config for seek
let cachedOpusHead: {
	channels: number;
	preSkip: number;
	description: Uint8Array<ArrayBufferLike>;
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
	let leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	let packetTimestampUs = isSeeking
		? Math.round((sampleOffset / OPUS_SAMPLE_RATE) * 1_000_000)
		: 0;
	const parserState = createFramedRawOpusStreamState();
	const streamDecoder = new StreamingOpusDecoder({
		processorPort,
		targetSampleRate,
		postMessage: (message) => self.postMessage(message),
		format: "RawOpus",
		sampleOffset,
		isSeeking,
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
		streamDecoder.setTotalBytes(totalBytes);

		// When seeking, use cached opus head to configure decoder immediately
		if (isSeeking && cachedOpusHead) {
			const configResult = await streamDecoder.configure(
				cachedOpusHead,
				"opus",
			);
			if (configResult.isErr()) {
				self.postMessage({
					type: "error",
					code: "DECODE",
					message: configResult.error.message,
				});
				return;
			}
		}

		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const parsedResult = parseFramedRawOpusStream(combined, parserState);
			if (parsedResult.isErr()) {
				self.postMessage({
					type: "error",
					code: "DECODE",
					message: parsedResult.error.message,
				});
				return;
			}
			const parsed = parsedResult.value;
			leftover = parsed.leftover;

			if (parsed.head != null && !streamDecoder.hasConfiguredDecoder) {
				cachedOpusHead = parsed.head;
				const configResult = await streamDecoder.configure(parsed.head, "opus");
				if (configResult.isErr()) {
					self.postMessage({
						type: "error",
						code: "DECODE",
						message: configResult.error.message,
					});
					return;
				}
			}

			for (const packet of parsed.packets) {
				const decodeResult = streamDecoder.decodePacket(
					packet,
					packetTimestampUs,
				);
				if (decodeResult.isErr()) {
					self.postMessage({
						type: "error",
						code: "DECODE",
						message: decodeResult.error.message,
					});
					return;
				}
				packetTimestampUs += 1;
			}
		}

		if (leftover.length > 0) {
			const parsedResult = parseFramedRawOpusStream(leftover, parserState);
			if (parsedResult.isErr()) {
				self.postMessage({
					type: "error",
					code: "DECODE",
					message: parsedResult.error.message,
				});
				return;
			}
			const parsed = parsedResult.value;
			if (parsed.leftover.length > 0) {
				self.postMessage({
					type: "error",
					code: "DECODE",
					message: "Framed raw Opus stream ended with a partial packet",
				});
				return;
			}
			if (parsed.head != null && !streamDecoder.hasConfiguredDecoder) {
				const configResult = await streamDecoder.configure(parsed.head, "opus");
				if (configResult.isErr()) {
					self.postMessage({
						type: "error",
						code: "DECODE",
						message: configResult.error.message,
					});
					return;
				}
			}
			for (const packet of parsed.packets) {
				const decodeResult = streamDecoder.decodePacket(
					packet,
					packetTimestampUs,
				);
				if (decodeResult.isErr()) {
					self.postMessage({
						type: "error",
						code: "DECODE",
						message: decodeResult.error.message,
					});
					return;
				}
				packetTimestampUs += 1;
			}
		}

		if (streamDecoder.hasConfiguredDecoder && streamDecoder.hasDecodedPackets) {
			await streamDecoder.flush();
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No framed raw Opus packets found in the stream",
			});
			return;
		}

		processorPort.postMessage({
			type: "bufferEnd",
			data: { totalLength: streamDecoder.samplesDecoded },
		});
		self.postMessage({
			type: "done",
			samplesDecoded: streamDecoder.samplesDecoded,
			sampleRate: OPUS_SAMPLE_RATE,
			channels: streamDecoder.channels,
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
		streamDecoder.close();
		processorPort.close();
		self.close();
	}
}
