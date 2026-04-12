// MP4/M4A AAC Decode Worker — runs fetch → MP4 demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { parseMp4 } from "./mp4-aac-parser";
import {
	concat,
	createThrottleStream,
	estimateTotalSamplesFromContentLength,
	resampleChannel,
} from "./worker-utils";

// ── Main worker entry ────────────────────────────────────────────────

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
			const resampledFrames = channelData[0].length;

			if (!didSendMeta) {
				didSendMeta = true;
				self.postMessage({
					type: "streamMeta",
					estimatedTotalSamples: null,
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
					sourceSampleRate: srcRate,
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

			processorPort.postMessage({
				type: "bufferRange",
				data: {
					startSample: samplesDecoded,
					channelData,
				},
			});

			samplesDecoded += resampledFrames;
			self.postMessage({ type: "decoded", samplesDecoded });
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

		// MP4 requires buffering the entire file before parsing sample tables,
		// so we accumulate all chunks and then parse + decode.
		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();
		let accumulated: Uint8Array = new Uint8Array(0);

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			accumulated = concat(accumulated, value);
			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });
		}

		// Parse MP4 structure
		const parsed = parseMp4(accumulated);
		if (!parsed) {
			self.postMessage({
				type: "error",
				message: "Failed to parse MP4: no audio track found",
			});
			return;
		}

		const { track, samples } = parsed;

		// Configure decoder with AudioSpecificConfig
		decoder.configure({
			codec: track.codecString,
			sampleRate: track.sampleRate,
			numberOfChannels: track.channelCount,
			description: track.audioSpecificConfig,
		});

		// Send streamMeta with known total
		const exactTotalSamples = samples.length * track.samplesPerFrame;
		const dstRate = targetSampleRate > 0 ? targetSampleRate : track.sampleRate;
		const scaledTotal =
			dstRate !== track.sampleRate
				? Math.ceil((exactTotalSamples * dstRate) / track.sampleRate)
				: exactTotalSamples;

		self.postMessage({
			type: "streamMeta",
			estimatedTotalSamples: scaledTotal,
			sampleRate: dstRate,
			channels: track.channelCount,
			isEstimate: false,
		});

		// Decode each AAC frame
		for (const sample of samples) {
			const frameData = accumulated.slice(
				sample.byteOffset,
				sample.byteOffset + sample.size,
			);
			decoder.decode(
				new EncodedAudioChunk({
					type: "key",
					timestamp: sample.timestampUs,
					data: frameData,
				}),
			);
		}

		await decoder.flush();

		// Signal end of buffer
		processorPort.postMessage({
			type: "bufferEnd",
			data: { totalLength: samplesDecoded },
		});

		self.postMessage({ type: "done", samplesDecoded });
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
