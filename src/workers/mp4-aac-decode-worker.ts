// MP4/M4A AAC Decode Worker — runs fetch → MP4 demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { parseMp4 } from "./mp4-aac-parser";
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

// ── Main worker entry ────────────────────────────────────────────────

let abortController: AbortController | null = null;
const gate = new BackpressureGate();
let currentPort: MessagePort | null = null;
let currentUrl = "";
let currentThrottle = 0;
let currentTargetSampleRate = 0;
let currentRetryConfig: StreamRetryConfig = DEFAULT_RETRY_CONFIG;

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
	const batcher = new FrameBatcher();

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
					format: "Mp4Aac",
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

		// MP4 requires buffering the entire file before parsing sample tables,
		// so we accumulate all chunks and then parse + decode.
		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();
		let accumulated: Uint8Array = new Uint8Array(0);

		while (true) {
			await gate.wait();
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
				code: "FORMAT_UNSUPPORTED",
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
		const trailing = batcher.flush();
		if (trailing !== null && (trailing[0]?.length ?? 0) > 0) {
			const trailSamples = trailing[0]?.length ?? 0;
			const trailStart = samplesDecoded - trailSamples;
			postBufferRange(processorPort, trailStart, trailing);
			postDecodedRange(trailStart, samplesDecoded);
		}

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
