// WebM Opus Decode Worker — runs fetch → WebM/Matroska demux → AudioDecoder off the main thread.
// Uses the local incremental parser to extract Opus packets and feeds them into WebCodecs.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { OPUS_SAMPLE_RATE, StreamingOpusDecoder } from "./opus-worker-common";
import {
	appendWebmOpusBytes,
	createWebmOpusParserState,
} from "./webm-opus-parser";
import {
	BackpressureGate,
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
// Cached codec config for seek (WebM needs EBML header to configure)
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
	const parserState = createWebmOpusParserState();
	const streamDecoder = new StreamingOpusDecoder({
		processorPort,
		targetSampleRate,
		postMessage: (message) => self.postMessage(message),
		format: "WebmOpus",
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

			const parsed = appendWebmOpusBytes(value, parserState);
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
					packet.packet,
					packet.timestampUs,
				);
				if (decodeResult.isErr()) {
					self.postMessage({
						type: "error",
						code: "DECODE",
						message: decodeResult.error.message,
					});
					return;
				}
			}
		}

		if (streamDecoder.hasConfiguredDecoder && streamDecoder.hasDecodedPackets) {
			await streamDecoder.flush();
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No WebM Opus packets found in the stream",
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
