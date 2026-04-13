// MP3 Decode Worker — runs fetch → MP3 demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import { parseId3v2 } from "./id3v2-parser";
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

// ── MP3 frame parser ─────────────────────────────────────────────────

const BITRATES = [
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
] as const;
const SAMPLE_RATES = [44100, 48000, 32000, 0] as const;
const SAMPLES_PER_FRAME = 1152; // MPEG1 Layer III

interface Mp3FrameInfo {
	offset: number;
	size: number;
	bitrate: number;
	sampleRate: number;
	channels: number;
}

interface ParseResult {
	frames: Mp3FrameInfo[];
	leftover: Uint8Array<ArrayBuffer>;
}

function parseMp3Frames(buf: Uint8Array): ParseResult {
	const frames: Mp3FrameInfo[] = [];
	let i = 0;

	// Skip ID3v2 tag if present
	if (
		buf.length >= 10 &&
		buf[0] === 0x49 &&
		buf[1] === 0x44 &&
		buf[2] === 0x33
	) {
		const size =
			((buf[6] & 0x7f) << 21) |
			((buf[7] & 0x7f) << 14) |
			((buf[8] & 0x7f) << 7) |
			(buf[9] & 0x7f);
		i = 10 + size;
	}

	while (i + 4 <= buf.length) {
		// Sync word: 11 set bits
		if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
			i++;
			continue;
		}

		const header = buf[i + 1];
		const mpegVersion = (header >> 3) & 0x03;
		const layer = (header >> 1) & 0x03;

		// Only MPEG1 Layer III
		if (mpegVersion !== 3 || layer !== 1) {
			i++;
			continue;
		}

		const bitrateIndex = (buf[i + 2] >> 4) & 0x0f;
		const sampleRateIndex = (buf[i + 2] >> 2) & 0x03;
		const padding = (buf[i + 2] >> 1) & 0x01;
		const channelMode = (buf[i + 3] >> 6) & 0x03;

		const bitrate = BITRATES[bitrateIndex] * 1000;
		const sampleRate = SAMPLE_RATES[sampleRateIndex];

		if (bitrate === 0 || sampleRate === 0) {
			i++;
			continue;
		}

		const frameSize = Math.floor((144 * bitrate) / sampleRate) + padding;

		if (i + frameSize > buf.length) {
			// Incomplete frame — return as leftover
			break;
		}

		frames.push({
			offset: i,
			size: frameSize,
			bitrate,
			sampleRate,
			channels: channelMode === 3 ? 1 : 2,
		});
		i += frameSize;
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
		// Abort current fetch and start new one from byte offset
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
					format: "Mp3",
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
					format: "Mp3",
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

			if (!didSignalSeeked) {
				didSignalSeeked = true;
				self.postMessage({ type: "seeked", sampleOffset: samplesDecoded });
			}

			samplesDecoded += resampledFrames;
			self.postMessage({ type: "decoded", samplesDecoded });
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
		let didParseMetadata = isSeeking;

		while (true) {
			await gate.wait();
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const combined = leftover.length > 0 ? concat(leftover, value) : value;

			// Try to extract ID3v2 metadata from the initial data
			if (!didParseMetadata) {
				didParseMetadata = true;
				const metadata = parseId3v2(combined);
				if (metadata) {
					metadata.codec = "mp3";
					self.postMessage({ type: "metadata", metadata });
				}
			}
			const { frames, leftover: remainder } = parseMp3Frames(combined);
			leftover = remainder;

			for (const frame of frames) {
				if (didSendMeta && totalBytes !== null) {
					const refinedEstimate = estimateTotalSamplesFromContentLength({
						totalBytes,
						bitrate: frame.bitrate,
						sourceSampleRate: frame.sampleRate,
						targetSampleRate:
							targetSampleRate > 0 ? targetSampleRate : frame.sampleRate,
						format: "Mp3",
					});
					if (refinedEstimate != null) {
						self.postMessage({
							type: "streamMeta",
							estimatedTotalSamples: refinedEstimate,
							sampleRate:
								targetSampleRate > 0 ? targetSampleRate : frame.sampleRate,
							channels: frame.channels,
							isEstimate: true,
						});
					}
				}

				if (!configuredDecoder) {
					decoder.configure({
						codec: "mp3",
						sampleRate: frame.sampleRate,
						numberOfChannels: frame.channels,
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
		} else {
			self.postMessage({
				type: "error",
				code: "FORMAT_UNSUPPORTED",
				message: "No MP3 frames found in the stream",
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
