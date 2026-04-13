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
import { concat, createThrottleStream } from "./worker-utils";

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
	let leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	let packetTimestampUs = 0;
	const parserState = createFramedRawOpusStreamState();
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

			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const parsed = parseFramedRawOpusStream(combined, parserState);
			leftover = parsed.leftover;

			if (parsed.head != null && !streamDecoder.hasConfiguredDecoder) {
				await streamDecoder.configure(parsed.head, "opus");
			}

			for (const packet of parsed.packets) {
				streamDecoder.decodePacket(packet, packetTimestampUs);
				packetTimestampUs += 1;
			}
		}

		if (leftover.length > 0) {
			const parsed = parseFramedRawOpusStream(leftover, parserState);
			if (parsed.leftover.length > 0) {
				throw new Error("Framed raw Opus stream ended with a partial packet");
			}
			if (parsed.head != null && !streamDecoder.hasConfiguredDecoder) {
				await streamDecoder.configure(parsed.head, "opus");
			}
			for (const packet of parsed.packets) {
				streamDecoder.decodePacket(packet, packetTimestampUs);
				packetTimestampUs += 1;
			}
		}

		if (streamDecoder.hasConfiguredDecoder && streamDecoder.hasDecodedPackets) {
			await streamDecoder.flush();
		} else {
			self.postMessage({
				type: "error",
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
				message: e instanceof Error ? e.message : String(e),
			});
		}
	} finally {
		streamDecoder.close();
		processorPort.close();
		self.close();
	}
}
