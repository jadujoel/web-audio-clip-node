import type { AudioDecoderPolyfillOptions, StreamFormat } from "../streaming";
import {
	createStreamingWorker,
	detectStreamFormatFromResponse,
} from "../streaming";
import { estimateByteOffsetFromSample } from "../streamTimeline";
import type {
	AudioMetadata,
	BufferedRange,
	GapPlaybackStrategy,
	StreamBufferSpan,
	StreamError,
	StreamErrorCode,
	StreamPreload,
	StreamReadyState,
} from "./types";

export interface PendingStart {
	when?: number;
	offset?: number;
	duration?: number;
}

/** Default pre-buffer: 1 second at 48 kHz. */
const DEFAULT_PRE_BUFFER_SAMPLES = 48_000;
/** Default resume-fetch threshold: 10 seconds at 48 kHz. */
const DEFAULT_RESUME_FETCH_AHEAD = 48_000 * 10;

/**
 * Merge a new [startSample, endSample) span into an existing sorted, merged
 * span array. Returns a new array (main thread - allocation is fine here).
 */
function mergeWrittenSpanIntoArray(
	spans: StreamBufferSpan[],
	startSample: number,
	endSample: number,
): StreamBufferSpan[] {
	const next = { startSample, endSample };
	const merged = [...spans, next].sort((a, b) => a.startSample - b.startSample);
	const result: StreamBufferSpan[] = [];
	for (const span of merged) {
		const prev = result[result.length - 1];
		if (!prev || span.startSample > prev.endSample) {
			result.push({ startSample: span.startSample, endSample: span.endSample });
		} else {
			prev.endSample = Math.max(prev.endSample, span.endSample);
		}
	}
	return result;
}

export interface StreamingClipNodeOptions {
	defaultFormat: StreamFormat | null;
	targetSampleRate: number;
	/** Send decoded PCM chunks as int16 to cut transfer memory roughly in half. */
	useInt16?: boolean;
	/** Injectable worker factory - used for testing without mocking globals. */
	createWorker?: (format: StreamFormat) => Worker | Promise<Worker>;
	/**
	 * Minimum decoded samples before playback starts.
	 * Prevents audible underruns when streaming over slow connections.
	 * Defaults to 48 000 (~1 s at 48 kHz).
	 */
	preBufferSamples?: number;
	/**
	 * Controls when streaming data is fetched.
	 * - "none": URL is stored but fetching is deferred until start()
	 * - "metadata": Only a HEAD request is made to detect format/size; full fetch on start()
	 * - "auto": Fetch starts immediately when URL is set (default)
	 */
	preload?: StreamPreload;
	/** Pause fetch when decoded buffer is this many samples ahead of playhead.
	 * Defaults to 48000 * 30 (30 seconds at 48 kHz). Set to 0 to disable. */
	pauseFetchAheadSamples?: number;
	/** Resume fetch when decoded buffer drops to this many samples ahead.
	 * Defaults to 48000 * 10 (10 seconds at 48 kHz). */
	resumeFetchAheadSamples?: number;
	/** Retry configuration for network failures. Set to false to disable retry. */
	retry?:
		| {
				maxRetries?: number;
				retryDelayMs?: number;
				backoffMultiplier?: number;
				maxRetryDelayMs?: number;
		  }
		| false;
	/**
	 * Policy for handling gaps in decoded audio during streaming.
	 * - "hold": Clamp playhead at committed edge.
	 * - "silence": Advance playhead through gaps, outputting silence.
	 */
	gapPlaybackStrategy?: GapPlaybackStrategy;
	/** Upfront target length in samples. */
	targetNumSamples?: number;
	/** Upfront target length in seconds. */
	targetDuration?: number;
	/** Number of samples to fade-in when transitioning from silence gap to real audio. */
	gapRecoveryFadeSamples?: number;
	/** AudioDecoder polyfill options for browsers without native WebCodecs support. */
	polyfill?: AudioDecoderPolyfillOptions;
	/** Optional network throttling used by the streaming example and tests. */
	throttle?: number;
}

export interface StreamControllerWorkerMessage {
	type: string;
	bytesReceived?: number;
	totalBytes?: number;
	samplesDecoded?: number;
	totalSamples?: number;
	startSample?: number;
	endSample?: number;
	message?: string;
	code?: StreamErrorCode;
	attempt?: number;
	delay?: number;
	error?: string;
	metadata?: AudioMetadata;
	sampleRate?: number;
	estimatedTotalSamples?: number | null;
	channels?: number;
}

export interface BufferStateSnapshot {
	writtenSpans: StreamBufferSpan[];
	committedLength: number;
	streamTotalLength: number | null;
	streamEnded: boolean;
}

interface ClipStreamControllerHost {
	readonly context: BaseAudioContext;
	readonly currentTime: number;
	transferPort(port: MessagePort): void;
	finalizeBuffer(totalLength?: number): void;
	startPlayback(when?: number, offset?: number, duration?: number): void;
	postProcessorMessage(message: { type: string; data?: unknown }): void;
	setDuration?(duration: number): void;
	completeSeek(): void;
	onLoadStart?(): void;
	onCanPlay?(): void;
	onCanPlayThrough?(): void;
	onWaiting?(): void;
	onProgress?(bytesReceived: number, totalBytes?: number): void;
	onRetry?(attempt: number, delay: number, error: string): void;
	onMetadata?(metadata: AudioMetadata): void;
	onDone?(): void;
	onError?(error: StreamError): void;
	onBufferChange?(buffered: BufferedRange[]): void;
	onReadyStateChange?(state: StreamReadyState): void;
	onWorkerMessage?(message: StreamControllerWorkerMessage): void;
}

export class ClipStreamController {
	private _url: string | undefined;
	private _worker: Worker | null = null;
	private _pendingStart: PendingStart | null = null;
	private _readyToPlay = false;
	private _streamDone = false;
	private _detectedFormat: StreamFormat | null = null;
	private _downloaded: PromiseWithResolvers<void> =
		Promise.withResolvers<void>();
	private _lastError: StreamError | null = null;
	private _readyState: StreamReadyState = "empty";
	private _streamStartTime = 0;
	private _totalBytesReceived = 0;
	private _totalBytesExpected: number | null = null;
	private _fetchPaused = false;
	private _streamStarting = false;
	private _streamDoneAcked = false;
	private _metadata: AudioMetadata | null = null;
	private _writtenSpans: StreamBufferSpan[] = [];
	private _committedLength = 0;
	private _streamTotalLength: number | null = null;
	private _streamEnded = false;

	constructor(
		private readonly host: ClipStreamControllerHost,
		private readonly options: StreamingClipNodeOptions,
	) {
		const strategy = this.resolveGapStrategy();
		this.host.postProcessorMessage({
			type: "streamGapStrategy",
			data: strategy,
		});
		const targetSamples = this.resolveTargetSamples();
		if (targetSamples !== null) {
			this.host.postProcessorMessage({
				type: "streamTargetLength",
				data: targetSamples,
			});
		}
		if (this.options.gapRecoveryFadeSamples !== undefined) {
			this.host.postProcessorMessage({
				type: "streamGapRecoveryFadeSamples",
				data: this.options.gapRecoveryFadeSamples,
			});
		}
	}

	private setReadyState(state: StreamReadyState): void {
		if (state === this._readyState) return;
		this._readyState = state;
		this.host.onReadyStateChange?.(state);
	}

	private resolveCompletionSamples(msg: {
		samplesDecoded?: number;
		totalSamples?: number;
	}): number {
		const declared = msg.samplesDecoded ?? msg.totalSamples ?? 0;
		if (!Number.isFinite(declared) || declared < 0) {
			return this._committedLength;
		}
		return Math.max(declared, this._committedLength);
	}

	private finalizeDownloadedIfReady(): void {
		if (!this._streamDoneAcked) return;
		if (!this._streamEnded) return;
		this.setReadyState("complete");
		this._streamDoneAcked = false;
		this._worker?.terminate();
		this._worker = null;
		this._downloaded.resolve();
	}

	private tryStart(samplesDecoded: number, threshold: number): void {
		this._committedLength = Math.max(this._committedLength, samplesDecoded);
		if (this._readyToPlay) return;
		if (samplesDecoded < threshold && !this._streamDone) return;
		this._readyToPlay = true;

		if (this._readyState === "loading") {
			this.setReadyState("canplay");
			this.host.onCanPlay?.();
		}

		if (this._pendingStart !== null) {
			const { when, offset, duration } = this._pendingStart;
			this._pendingStart = null;
			this.host.startPlayback(when, offset, duration);
		}
	}

	private checkBackpressure(): void {
		const pauseThreshold = this.options.pauseFetchAheadSamples ?? 0;
		if (pauseThreshold === 0 || !this._worker || this._streamDone) return;

		const resumeThreshold =
			this.options.resumeFetchAheadSamples ?? DEFAULT_RESUME_FETCH_AHEAD;
		const playheadSamples = Math.round(
			this.host.currentTime * this.host.context.sampleRate,
		);
		const bufferedAhead = this._committedLength - playheadSamples;

		if (!this._fetchPaused && bufferedAhead > pauseThreshold) {
			this._fetchPaused = true;
			this._worker.postMessage({ type: "pause-fetch" });
		} else if (this._fetchPaused && bufferedAhead < resumeThreshold) {
			this._fetchPaused = false;
			this._worker.postMessage({ type: "resume-fetch" });
		}
	}

	private applyDecodedRange(startSample: number, endSample: number): void {
		if (
			!Number.isFinite(startSample) ||
			!Number.isFinite(endSample) ||
			endSample <= startSample ||
			startSample < 0
		) {
			return;
		}
		this._writtenSpans = mergeWrittenSpanIntoArray(
			this._writtenSpans,
			startSample,
			endSample,
		);
		this._committedLength = Math.max(this._committedLength, endSample);
		this.host.onBufferChange?.(this.buffered);
	}

	private async probeMetadata(url: string): Promise<void> {
		try {
			const format =
				this.options.defaultFormat ??
				(await detectStreamFormatFromResponse(url));
			this._detectedFormat = format;
		} catch {
			// Metadata probe failed - full fetch on start() will retry.
		}
	}

	private async startStream(url: string): Promise<void> {
		this._streamStarting = true;
		if (this.options.useInt16) {
			console.warn(
				"StreamingClipNode: useInt16 is deprecated and has no effect. Float32 is always used for transfer to avoid audio-thread GC.",
			);
		}

		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}

		this._readyToPlay = false;
		this._streamDone = false;
		this._fetchPaused = false;
		this._metadata = null;
		this._downloaded = Promise.withResolvers<void>();
		this._lastError = null;
		this._totalBytesReceived = 0;
		this._totalBytesExpected = null;
		this._streamStartTime = performance.now();
		this._streamDoneAcked = false;
		this._writtenSpans = [];
		this._committedLength = 0;
		this._streamTotalLength = null;
		this._streamEnded = false;

		this.setReadyState("loading");
		this.host.onLoadStart?.();

		let format: StreamFormat;
		let worker: Worker;
		try {
			format =
				this.options.defaultFormat ??
				this._detectedFormat ??
				(await detectStreamFormatFromResponse(url));
			const workerFactory =
				this.options.createWorker ??
				((nextFormat: StreamFormat) =>
					createStreamingWorker(nextFormat, this.options.polyfill));
			worker = await workerFactory(format);
		} catch {
			this._streamStarting = false;
			return;
		}
		this._worker = worker;
		this._streamStarting = false;

		const channel = new MessageChannel();
		this.host.transferPort(channel.port2);

		const threshold =
			this.options.preBufferSamples ?? DEFAULT_PRE_BUFFER_SAMPLES;

		worker.onmessage = (ev: MessageEvent) => {
			const msg = ev.data as StreamControllerWorkerMessage;

			if (msg.type === "decoded") {
				this.tryStart(msg.samplesDecoded ?? 0, threshold);
				this.checkBackpressure();
			} else if (msg.type === "decodedRange") {
				this.applyDecodedRange(msg.startSample ?? 0, msg.endSample ?? 0);
			} else if (msg.type === "progress") {
				this._totalBytesReceived = msg.bytesReceived ?? 0;
				this._totalBytesExpected = msg.totalBytes ?? this._totalBytesExpected;
				this.host.onProgress?.(
					this._totalBytesReceived,
					this._totalBytesExpected ?? undefined,
				);
			} else if (msg.type === "retry") {
				const attempt = msg.attempt ?? 0;
				const delay = msg.delay ?? 0;
				const error = msg.error ?? "Unknown error";
				this.host.onRetry?.(attempt, delay, error);
			} else if (msg.type === "streamMeta") {
				const sr = msg.sampleRate ?? this.host.context.sampleRate;
				const estimatedTotalSamples = msg.estimatedTotalSamples;
				if (
					estimatedTotalSamples != null &&
					Number.isFinite(estimatedTotalSamples) &&
					estimatedTotalSamples > 0 &&
					sr > 0
				) {
					this.host.setDuration?.(estimatedTotalSamples / sr);
				}
			} else if (msg.type === "metadata" && msg.metadata) {
				this._metadata = msg.metadata;
				if (
					msg.metadata.duration != null &&
					Number.isFinite(msg.metadata.duration) &&
					msg.metadata.duration > 0
				) {
					this.host.setDuration?.(msg.metadata.duration);
				}
				this.host.onMetadata?.(msg.metadata);
			} else if (msg.type === "done") {
				const completionSamples = this.resolveCompletionSamples(msg);
				this._committedLength = Math.max(
					this._committedLength,
					completionSamples,
				);
				this.host.setDuration?.(
					completionSamples / this.host.context.sampleRate,
				);
				this.host.finalizeBuffer(completionSamples);
				this._streamDone = true;
				this._streamDoneAcked = true;
				this.tryStart(completionSamples, 0);
				this.finalizeDownloadedIfReady();
				this.host.onDone?.();
			} else if (msg.type === "seeked") {
				this.host.completeSeek();
			} else if (msg.type === "error") {
				const errorMsg = msg.message ?? "Unknown streaming error";
				const error: StreamError = {
					code: msg.code ?? "DECODE",
					message: errorMsg,
				};
				this._lastError = error;
				this._downloaded.reject(new Error(errorMsg));
				this._worker?.terminate();
				this._worker = null;
				this.host.onError?.(error);
			}

			this.host.onWorkerMessage?.(msg);
		};

		worker.postMessage(
			{
				type: "init",
				port: channel.port1,
				url,
				useInt16: this.options.useInt16 ?? false,
				throttle: this.options.throttle ?? 0,
				targetSampleRate: this.options.targetSampleRate,
				retry:
					this.options.retry === false ? null : (this.options.retry ?? null),
			},
			[channel.port1],
		);
	}

	private terminateWorker(): void {
		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}
	}

	private resolveGapStrategy(): GapPlaybackStrategy {
		if (this.options.gapPlaybackStrategy) {
			return this.options.gapPlaybackStrategy;
		}
		return this.resolveTargetSamples() !== null ? "silence" : "hold";
	}

	private resolveTargetSamples(): number | null {
		if (this.options.targetNumSamples !== undefined) {
			return this.options.targetNumSamples;
		}
		if (this.options.targetDuration !== undefined) {
			return Math.round(
				this.options.targetDuration * this.host.context.sampleRate,
			);
		}
		return null;
	}

	get gapPlaybackStrategy(): GapPlaybackStrategy {
		return this.resolveGapStrategy();
	}

	set gapPlaybackStrategy(value: GapPlaybackStrategy) {
		this.options.gapPlaybackStrategy = value;
		this.host.postProcessorMessage({ type: "streamGapStrategy", data: value });
	}

	get targetNumSamples(): number | undefined {
		return this.options.targetNumSamples;
	}

	set targetNumSamples(value: number | undefined) {
		this.options.targetNumSamples = value;
		this.host.postProcessorMessage({
			type: "streamTargetLength",
			data: this.resolveTargetSamples(),
		});
	}

	get targetDuration(): number | undefined {
		return this.options.targetDuration;
	}

	set targetDuration(value: number | undefined) {
		this.options.targetDuration = value;
		this.host.postProcessorMessage({
			type: "streamTargetLength",
			data: this.resolveTargetSamples(),
		});
	}

	get gapRecoveryFadeSamples(): number {
		return this.options.gapRecoveryFadeSamples ?? 128;
	}

	set gapRecoveryFadeSamples(value: number) {
		this.options.gapRecoveryFadeSamples = value;
		this.host.postProcessorMessage({
			type: "streamGapRecoveryFadeSamples",
			data: value,
		});
	}

	get preload(): StreamPreload {
		return this.options.preload ?? "auto";
	}

	get throttle(): number {
		return this.options.throttle ?? 0;
	}

	set throttle(value: number) {
		this.options.throttle = value;
	}

	get metadata(): AudioMetadata | null {
		return this._metadata;
	}

	get readyState(): StreamReadyState {
		return this._readyState;
	}

	get buffered(): BufferedRange[] {
		const sr = this.host.context.sampleRate;
		return this._writtenSpans.map((span) => ({
			start: span.startSample / sr,
			end: span.endSample / sr,
		}));
	}

	get bufferedLength(): number {
		return this._committedLength / this.host.context.sampleRate;
	}

	get downloaded(): Promise<void> {
		return this._downloaded.promise;
	}

	get error(): StreamError | null {
		return this._lastError;
	}

	get url(): string | undefined {
		return this._url;
	}

	setUrl(value: string): void {
		this._url = value;
		const preload = this.options.preload ?? "auto";
		if (preload === "none") {
			return;
		}
		if (preload === "metadata") {
			void this.probeMetadata(value);
			return;
		}
		void this.startStream(value);
	}

	handleBufferStateChanged(state: BufferStateSnapshot): void {
		this._writtenSpans = [...state.writtenSpans];
		this._committedLength = state.committedLength;
		this._streamTotalLength = state.streamTotalLength;
		this._streamEnded = state.streamEnded;
		this.finalizeDownloadedIfReady();
		this.host.onBufferChange?.(this.buffered);
		this.checkBackpressure();

		if (this._readyState === "loading" && this._readyToPlay) {
			this.setReadyState("canplay");
			this.host.onCanPlay?.();
		}

		if (this._readyState === "canplay") {
			if (
				this.resolveGapStrategy() === "silence" &&
				this.resolveTargetSamples() !== null
			) {
				this.setReadyState("canplaythrough");
				this.host.onCanPlayThrough?.();
			} else if (
				this._streamTotalLength !== null &&
				this._totalBytesReceived > 0
			) {
				const elapsed = (performance.now() - this._streamStartTime) / 1000;
				if (elapsed > 0) {
					const bytesPerSecond = this._totalBytesReceived / elapsed;
					const sr = this.host.context.sampleRate;
					const remainingSamples =
						this._streamTotalLength - this._committedLength;
					const committedBytes =
						this._committedLength > 0
							? this._totalBytesReceived *
								(this._streamTotalLength / this._committedLength)
							: 0;
					const remainingBytes = committedBytes - this._totalBytesReceived;
					const remainingDownloadSeconds =
						remainingBytes > 0 ? remainingBytes / bytesPerSecond : 0;
					const remainingPlaybackSeconds = remainingSamples / sr;
					if (remainingDownloadSeconds < remainingPlaybackSeconds) {
						this.setReadyState("canplaythrough");
						this.host.onCanPlayThrough?.();
					}
				}
			}
		}
	}

	handleBufferUnderrun(): void {
		if (
			this._readyState === "canplay" ||
			this._readyState === "canplaythrough"
		) {
			this.setReadyState("loading");
			this.host.onWaiting?.();
		}
		this.checkBackpressure();
	}

	handleSeekStarted(targetSample: number): void {
		for (const span of this._writtenSpans) {
			if (targetSample >= span.startSample && targetSample < span.endSample) {
				this.host.completeSeek();
				return;
			}
		}

		if (!this._worker) {
			this.host.completeSeek();
			return;
		}

		const totalSamples = this._streamTotalLength ?? 0;
		const totalBytes = this._totalBytesReceived;
		const byteOffset = estimateByteOffsetFromSample({
			sampleOffset: targetSample,
			totalSamples,
			totalBytes,
		});

		this._worker.postMessage({
			type: "seek",
			sampleOffset: targetSample,
			byteOffset,
		});
	}

	start(when?: number, offset?: number, duration?: number): void {
		if (
			this._url &&
			!this._worker &&
			!this._streamStarting &&
			!this._streamDone
		) {
			void this.startStream(this._url);
		}
		if (this._readyToPlay || this._url === "") {
			this.host.startPlayback(when, offset, duration);
		} else {
			this._pendingStart = { when, offset, duration };
		}
	}

	stop(): void {
		this.terminateWorker();
	}

	dispose(): void {
		this.terminateWorker();
		this._pendingStart = null;
		this._readyToPlay = false;
		this._streamDone = true;
		this._metadata = null;
		this._detectedFormat = null;
		this._lastError = null;
		this._url = undefined;
		this._writtenSpans = [];
		this._committedLength = 0;
		this._streamTotalLength = null;
		this._streamEnded = false;
		this._totalBytesReceived = 0;
		this._totalBytesExpected = null;
		this._fetchPaused = false;
		this._streamStarting = false;
		this._streamDoneAcked = false;
		this.setReadyState("empty");
	}
}
