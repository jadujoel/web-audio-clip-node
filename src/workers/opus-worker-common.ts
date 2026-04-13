import {
	estimateTotalSamplesFromContentLength,
	FrameBatcher,
	postBufferRange,
	postDecodedRange,
	resampleChannel,
} from "./worker-utils";

export const OPUS_SAMPLE_RATE = 48_000;

const textDecoder = new TextDecoder();

export interface OpusHead {
	channels: number;
	preSkip: number;
	description: Uint8Array<ArrayBufferLike>;
}

export function parseOpusHead(packet: Uint8Array): OpusHead | null {
	if (packet.length < 19) return null;
	const magic = textDecoder.decode(packet.slice(0, 8));
	if (magic !== "OpusHead") return null;
	const channels = packet[9] ?? 0;
	const preSkip = (packet[10] ?? 0) | ((packet[11] ?? 0) << 8);
	return {
		channels,
		preSkip,
		description: packet,
	};
}

export function createFallbackOpusHead(channels: number): OpusHead {
	const description = new Uint8Array(19);
	description.set(new TextEncoder().encode("OpusHead"), 0);
	description[8] = 1;
	description[9] = channels;
	return {
		channels,
		preSkip: 0,
		description,
	};
}

interface StreamingOpusDecoderOptions {
	processorPort: MessagePort;
	targetSampleRate: number;
	postMessage: (message: unknown) => void;
	format?: string;
	sampleOffset?: number;
	isSeeking?: boolean;
}

export class StreamingOpusDecoder {
	private readonly processorPort: MessagePort;
	private readonly targetSampleRate: number;
	private readonly postMessage: (message: unknown) => void;
	private readonly format: string | undefined;
	private readonly decoder: AudioDecoder;
	private readonly batcher = new FrameBatcher();
	private totalBytes: number | null = null;
	private samplesDecodedCount = 0;
	private didSendMeta = false;
	private initialized = false;
	private configured = false;
	private decodedAnyPacket = false;
	private streamChannels = 2;
	private preSkipSourceSamples = 0;
	private preSkipTargetSamples = 0;
	private samplesSkipped = 0;
	private allowTimestampProbe = false;
	private preSkipProbeDone = false;
	private shouldApplyPreSkip = true;
	private didSignalSeeked = true;
	private lastConfig: {
		codec: string;
		sampleRate: number;
		numberOfChannels: number;
		descriptionLength: number;
	} | null = null;

	constructor({
		processorPort,
		targetSampleRate,
		postMessage,
		format,
		sampleOffset = 0,
		isSeeking = false,
	}: StreamingOpusDecoderOptions) {
		this.processorPort = processorPort;
		this.targetSampleRate = targetSampleRate;
		this.postMessage = postMessage;
		this.format = format;
		this.samplesDecodedCount = sampleOffset;
		this.initialized = isSeeking;
		this.didSendMeta = isSeeking;
		this.didSignalSeeked = !isSeeking;
		this.decoder = new AudioDecoder({
			output: this.handleOutput,
			error: (error: DOMException) => {
				this.postMessage({
					type: "error",
					message:
						this.lastConfig == null
							? error.message
							: `${error.message} (${JSON.stringify({
									configured: this.configured,
									decodedAnyPacket: this.decodedAnyPacket,
									config: this.lastConfig,
								})})`,
				});
			},
		});
	}

	setTotalBytes(totalBytes: number | null) {
		this.totalBytes = totalBytes;
	}

	async configure(head: OpusHead, bitstreamFormat: "ogg" | "opus") {
		if (head.channels <= 0) {
			throw new Error("Opus stream contains invalid channel count");
		}
		this.streamChannels = head.channels;
		this.preSkipSourceSamples = head.preSkip;
		const dstRate =
			this.targetSampleRate > 0 ? this.targetSampleRate : OPUS_SAMPLE_RATE;
		this.preSkipTargetSamples = Math.round(
			(this.preSkipSourceSamples / OPUS_SAMPLE_RATE) * dstRate,
		);
		this.allowTimestampProbe = bitstreamFormat === "ogg";
		this.preSkipProbeDone = false;
		this.shouldApplyPreSkip = true;
		const config: AudioDecoderConfig = {
			codec: "opus",
			sampleRate: OPUS_SAMPLE_RATE,
			numberOfChannels: head.channels,
			description: head.description,
		};
		this.lastConfig = {
			codec: config.codec,
			sampleRate: config.sampleRate,
			numberOfChannels: config.numberOfChannels,
			descriptionLength: head.description.length,
		};
		const support = await AudioDecoder.isConfigSupported(config);
		if (!support.supported) {
			throw new Error(
				`Unsupported Opus decoder config: ${JSON.stringify({
					codec: config.codec,
					sampleRate: config.sampleRate,
					numberOfChannels: config.numberOfChannels,
					descriptionLength: head.description.length,
				})}`,
			);
		}
		this.decoder.configure(config);
		this.configured = true;
	}

	decodePacket(packet: Uint8Array, timestampUs: number) {
		if (!this.configured) {
			throw new Error("Decoder is not configured for Opus stream");
		}
		this.decoder.decode(
			new EncodedAudioChunk({
				type: "key",
				timestamp: timestampUs,
				data: packet,
			}),
		);
		this.decodedAnyPacket = true;
	}

	async flush() {
		await this.decoder.flush();
		// Flush any remaining batched frames at end-of-stream
		const flushed = this.batcher.flush();
		if (flushed !== null && (flushed[0]?.length ?? 0) > 0) {
			const fSamples = flushed[0]?.length ?? 0;
			const fStart = this.samplesDecodedCount - fSamples;
			postBufferRange(this.processorPort, fStart, flushed);
			postDecodedRange(fStart, this.samplesDecodedCount);
		}
	}

	close() {
		try {
			this.decoder.close();
		} catch {
			// already closed
		}
	}

	get samplesDecoded() {
		return this.samplesDecodedCount;
	}

	get channels() {
		return this.streamChannels;
	}

	get hasConfiguredDecoder() {
		return this.configured;
	}

	get hasDecodedPackets() {
		return this.decodedAnyPacket;
	}

	private readonly handleOutput = (audioData: AudioData) => {
		const numFrames = audioData.numberOfFrames;
		const numChannels = audioData.numberOfChannels;
		const srcRate = audioData.sampleRate;
		const dstRate = this.targetSampleRate > 0 ? this.targetSampleRate : srcRate;
		if (this.allowTimestampProbe && !this.preSkipProbeDone) {
			const preSkipUs = Math.round(
				(this.preSkipSourceSamples / OPUS_SAMPLE_RATE) * 1_000_000,
			);
			if (audioData.timestamp >= preSkipUs && preSkipUs > 0) {
				this.shouldApplyPreSkip = false;
			}
			this.preSkipProbeDone = true;
		}

		const channelData: Float32Array[] = [];
		for (let ch = 0; ch < numChannels; ch++) {
			const raw = new Float32Array(numFrames);
			audioData.copyTo(raw, { planeIndex: ch, format: "f32-planar" });
			channelData.push(resampleChannel(raw, srcRate, dstRate));
		}
		audioData.close();

		let resampledFrames = channelData[0]?.length ?? 0;
		if (
			this.shouldApplyPreSkip &&
			this.samplesSkipped < this.preSkipTargetSamples &&
			resampledFrames > 0
		) {
			const toSkip = Math.min(
				this.preSkipTargetSamples - this.samplesSkipped,
				resampledFrames,
			);
			this.samplesSkipped += toSkip;
			if (toSkip === resampledFrames) {
				return;
			}
			for (let ch = 0; ch < channelData.length; ch++) {
				channelData[ch] = channelData[ch].subarray(toSkip);
			}
			resampledFrames = channelData[0]?.length ?? 0;
		}

		if (!this.didSendMeta) {
			this.didSendMeta = true;
			const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
				totalBytes: this.totalBytes,
				bitrate: null,
				sourceSampleRate: OPUS_SAMPLE_RATE,
				targetSampleRate: dstRate,
				format: this.format,
			});
			this.postMessage({
				type: "streamMeta",
				estimatedTotalSamples,
				sampleRate: dstRate,
				channels: numChannels,
				isEstimate: true,
			});
		}

		if (!this.initialized) {
			this.initialized = true;
			const estimatedTotalSamples = estimateTotalSamplesFromContentLength({
				totalBytes: this.totalBytes,
				bitrate: null,
				sourceSampleRate: OPUS_SAMPLE_RATE,
				targetSampleRate: dstRate,
				format: this.format,
			});
			this.processorPort.postMessage({
				type: "bufferInit",
				data: {
					channels: numChannels,
					totalLength: estimatedTotalSamples ?? 0,
					streaming: true,
				},
			});
			this.postMessage({
				type: "info",
				sampleRate: srcRate,
				channels: numChannels,
			});
		}

		if (resampledFrames > 0) {
			const startSample = this.samplesDecodedCount;
			this.samplesDecodedCount += resampledFrames;
			this.postMessage({
				type: "decoded",
				samplesDecoded: this.samplesDecodedCount,
			});

			const batch = this.batcher.add(channelData);
			if (batch !== null) {
				const batchSamples = batch[0]?.length ?? 0;
				const batchStart = this.samplesDecodedCount - batchSamples;
				postBufferRange(this.processorPort, batchStart, batch);
				postDecodedRange(batchStart, this.samplesDecodedCount);
			}

			if (!this.didSignalSeeked) {
				this.didSignalSeeked = true;
				this.postMessage({
					type: "seeked",
					sampleOffset: startSample,
				});
				// Flush partial batch immediately on seek signal for responsiveness
				const flushed = this.batcher.flush();
				if (flushed?.[0] && flushed[0].length > 0) {
					const fSamples = flushed[0].length;
					const fStart = this.samplesDecodedCount - fSamples;
					postBufferRange(this.processorPort, fStart, flushed);
					postDecodedRange(fStart, this.samplesDecodedCount);
				}
			}
		}
	};
}
