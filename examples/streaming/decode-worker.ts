// Decode Worker — runs fetch → MP3 demux → AudioDecoder off the main thread.
// Sends decoded Float32Array data directly to the ClipProcessor via a
// transferred MessagePort, bypassing the main thread for audio data.

declare const self: DedicatedWorkerGlobalScope;

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
	leftover: Uint8Array;
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

		const frameSize =
			Math.floor((144 * bitrate) / sampleRate) + padding;

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

// ── Concat helper ────────────────────────────────────────────────────

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

// ── Main worker entry ────────────────────────────────────────────────

let abortController: AbortController | null = null;

self.onmessage = (ev: MessageEvent) => {
	const { type } = ev.data;
	if (type === "init") {
		const { port, url } = ev.data as {
			port: MessagePort;
			url: string;
		};
		abortController = new AbortController();
		startStreaming(port, url, abortController.signal);
	} else if (type === "abort") {
		abortController?.abort();
	}
};

async function startStreaming(
	processorPort: MessagePort,
	url: string,
	signal: AbortSignal,
) {
	let totalBytes: number | null = null;
	let bytesReceived = 0;
	let samplesDecoded = 0;
	let leftover = new Uint8Array(0);
	let initialized = false;
	let decoderDone: (() => void) | null = null;
	let channels = 2;
	let mp3SampleRate = 44100;

	// We'll resolve this when decoder is fully flushed
	const decoderFlushed = new Promise<void>((resolve) => {
		decoderDone = resolve;
	});

	const decoder = new AudioDecoder({
		output(audioData: AudioData) {
			const numFrames = audioData.numberOfFrames;
			const numChannels = audioData.numberOfChannels;
			const channelData: Float32Array[] = [];

			for (let ch = 0; ch < numChannels; ch++) {
				const dest = new Float32Array(numFrames);
				audioData.copyTo(dest, { planeIndex: ch, format: "f32-planar" });
				channelData.push(dest);
			}
			audioData.close();

			if (!initialized) {
				initialized = true;
				channels = numChannels;
				mp3SampleRate = audioData.sampleRate;

				// Estimate total samples from Content-Length if available
				let estimatedTotalSamples: number | null = null;
				if (totalBytes !== null) {
					// Rough estimate; will be corrected by bufferEnd
					estimatedTotalSamples = Math.ceil(
						(totalBytes / 417) * SAMPLES_PER_FRAME,
					); // ~128kbps average frame size
				}

				processorPort.postMessage({
					type: "bufferInit",
					data: {
						channels: numChannels,
						totalLength: estimatedTotalSamples ?? 0,
						streaming: true,
					},
				});

				self.postMessage({ type: "info", sampleRate: audioData.sampleRate, channels: numChannels });
			}

			processorPort.postMessage({
				type: "bufferRange",
				data: {
					startSample: samplesDecoded,
					channelData,
				},
			});

			samplesDecoded += numFrames;
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

		const reader = response.body.getReader();
		let configuredDecoder = false;
		let timestampUs = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			bytesReceived += value.length;
			self.postMessage({ type: "progress", bytesReceived, totalBytes });

			const combined = leftover.length > 0 ? concat(leftover, value) : value;
			const { frames, leftover: remainder } = parseMp3Frames(combined);
			leftover = remainder;

			for (const frame of frames) {
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
		decoderDone?.();
	}
}
