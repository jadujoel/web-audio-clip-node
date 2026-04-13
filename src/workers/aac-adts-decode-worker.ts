// AAC ADTS Decode Worker — runs fetch → ADTS demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

// @ts-expect-error redeclare self as DedicatedWorkerGlobalScope
declare const self: DedicatedWorkerGlobalScope;

import {
	concat,
	createThrottleStream,
	estimateTotalSamplesFromContentLength,
	resampleChannel,
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
	let leftover = new Uint8Array(0);
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
				const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
					totalBytes,
					bitrate: null,
					sourceSampleRate: srcRate,
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

		const body =
			throttle > 0
				? response.body.pipeThrough(createThrottleStream(throttle))
				: response.body;
		const reader = body.getReader();
		let configuredDecoder = false;
		let timestampUs = 0;

		while (true) {
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
		} else {
			self.postMessage({
				type: "error",
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
