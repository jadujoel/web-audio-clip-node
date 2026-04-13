// AAC ADTS Decode Worker — runs fetch → ADTS demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import {
	BackpressureGate,
	concat,
	createThrottleStream,
	DEFAULT_RETRY_CONFIG,
	estimateTotalSamplesFromContentLength,
	fetchWithRetry,
	FrameBatcher,
	postDecodedRange,
	parseTotalBytes,
	postBufferRange,
	resampleChannel,
	type StreamRetryConfig,
} from "./worker-utils";

// ── ADTS frame parser ────────────────────────────────────────────────

const SAMPLE_RATES = [
	96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
	8000, 7350,
] as const;

const SAMPLES_PER_FRAME = 1024; // AAC-LC

export interface AdtsFrameInfo {
	offset: number;
	size: number;
	sampleRate: number;
	channels: number;
	profile: number;
	headerSize: number;
}

export interface ParseResult {
	frames: AdtsFrameInfo[];
	leftover: Uint8Array<ArrayBuffer>;
}

export function parseAdtsFrames(buf: Uint8Array): ParseResult {
	const frames: AdtsFrameInfo[] = [];
	let i = 0;

	while (i + 7 <= buf.length) {
		// Syncword: 0xFFF (12 bits)
		if (buf[i] !== 0xff || (buf[i + 1] & 0xf0) !== 0xf0) {
			i++;
			continue;
		}

		const protectionAbsent = buf[i + 1] & 0x01;
		const headerSize = protectionAbsent ? 7 : 9;

		if (i + headerSize > buf.length) {
			break;
		}

		const profile = ((buf[i + 2] >> 6) & 0x03) + 1; // audioObjectType = profile + 1
		const samplingFreqIndex = (buf[i + 2] >> 2) & 0x0f;
		const channelConfig =
			((buf[i + 2] & 0x01) << 2) | ((buf[i + 3] >> 6) & 0x03);

		const frameLength =
			((buf[i + 3] & 0x03) << 11) |
			(buf[i + 4] << 3) |
			((buf[i + 5] >> 5) & 0x07);

		const sampleRate = SAMPLE_RATES[samplingFreqIndex];

		if (
			sampleRate === undefined ||
			channelConfig === 0 ||
			frameLength < headerSize
		) {
			i++;
			continue;
		}

		if (i + frameLength > buf.length) {
			// Incomplete frame — return as leftover
			break;
		}

		frames.push({
			offset: i,
			size: frameLength,
			sampleRate,
			channels: channelConfig,
			profile,
			headerSize,
		});
		i += frameLength;
	}

	return { frames, leftover: buf.slice(i) };
}

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
		const { port, url, throttle, targetSampleRate, retry } =
			ev.data as {
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
	let leftover = new Uint8Array(0);
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
				const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
					totalBytes,
					bitrate: null,
					sourceSampleRate: srcRate,
					targetSampleRate: dstRate,
					format: "Aac",
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
					sourceSampleRate: srcRate,
					targetSampleRate: dstRate,
					format: "Aac",
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

		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();
		let configuredDecoder = false;
		let timestampUs = isSeeking
			? Math.round((sampleOffset / 48_000) * 1_000_000)
			: 0;

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const { frames, leftover: remainder } = parseAdtsFrames(combined);
			leftover = remainder;

			for (const frame of frames) {
				if (!configuredDecoder) {
					decoder.configure({
						codec: "mp4a.40.2", // AAC-LC
						sampleRate: frame.sampleRate,
						numberOfChannels: frame.channels,
						// No description = ADTS mode per W3C AAC WebCodecs Registration
					});
					configuredDecoder = true;
				}

				const frameData = combined.slice(
					frame.offset,
					frame.offset + frame.size,
				);
				decoder.decode(
					new EncodedAudioChunk({
						type: "key",
						timestamp: timestampUs,
						data: frameData,
					}),
				);
				timestampUs += Math.round(
					(SAMPLES_PER_FRAME / frame.sampleRate) * 1_000_000,
				);
			}
		}

		// Flush remaining decoded data
		if (configuredDecoder) {
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
				message: "No ADTS frames found in the stream",
			});
			return;
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
