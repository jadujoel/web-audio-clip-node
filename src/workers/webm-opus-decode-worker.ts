// WebM Opus Decode Worker — runs fetch → WebM/Matroska demux → AudioDecoder off the main thread.
// Uses the local incremental parser to extract Opus packets and feeds them into WebCodecs.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { OPUS_SAMPLE_RATE, StreamingOpusDecoder } from "./opus-worker-common";
import {
	appendWebmOpusBytes,
	createWebmOpusParserState,
} from "./webm-opus-parser";
import { createThrottleStream } from "./worker-utils";

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
	const parserState = createWebmOpusParserState();
	const streamDecoder = new StreamingOpusDecoder({
		processorPort,
		targetSampleRate,
		postMessage: (message) => self.postMessage(message),
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
		streamDecoder.setTotalBytes(totalBytes);

		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const parsed = appendWebmOpusBytes(value, parserState);
			if (parsed.head != null && !streamDecoder.hasConfiguredDecoder) {
				await streamDecoder.configure(parsed.head, "opus");
			}
			for (const packet of parsed.packets) {
				streamDecoder.decodePacket(packet.packet, packet.timestampUs);
			}
		}

		if (streamDecoder.hasConfiguredDecoder && streamDecoder.hasDecodedPackets) {
			await streamDecoder.flush();
		} else {
			self.postMessage({
				type: "error",
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
				message: e instanceof Error ? e.message : String(e),
			});
		}
	} finally {
		streamDecoder.close();
		processorPort.close();
	}
}
