import type { StreamFormat } from "../streaming";
import {
	createStreamingWorker,
	detectStreamFormatFromResponse,
} from "../streaming";
import { estimateByteOffsetFromSample } from "../streamTimeline";
import { ClipNode } from "./ClipNode";
import type {
	AudioMetadata,
	BufferedRange,
	ClipNodeEventMap,
	ClipWorkletOptions,
	StreamBufferSpan,
	StreamError,
	StreamErrorCode,
	StreamingClipNodeEventMap,
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

/** Default resume-fetch threshold: 10 seconds at 48 kHz. */
const DEFAULT_RESUME_FETCH_AHEAD = 48_000 * 10;

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
}

export class StreamingClipNode extends ClipNode {
	private _url: string | undefined;
	private _worker: Worker | null = null;
	private _pendingStart: PendingStart | null = null;
	private _readyToPlay = false;
	private _streamDone = false;
	private _detectedFormat: StreamFormat | null = null;
	private _streamOptions: StreamingClipNodeOptions;
	private _downloaded: PromiseWithResolvers<void> =
		Promise.withResolvers<void>();
	private _lastError: StreamError | null = null;
	private _readyState: StreamReadyState = "empty";
	private _streamStartTime = 0;
	private _totalBytesReceived = 0;
	private _fetchPaused = false;
	private _streamStarting = false;
	private _streamDoneAcked = false;

	onerror?: (error: StreamError) => void;
	onprogress?: (bytesReceived: number) => void;
	ondone?: () => void;
	onwaiting?: () => void;
	oncanplay?: () => void;
	oncanplaythrough?: () => void;
	onloadstart?: () => void;
	onreadystatechange?: (state: StreamReadyState) => void;
	onretry?: (attempt: number, delay: number, error: string) => void;
	onmetadata?: (metadata: AudioMetadata) => void;

	private _metadata: AudioMetadata | null = null;

	constructor(
		public context: BaseAudioContext,
		options: ClipWorkletOptions = {},
		streamOptions: StreamingClipNodeOptions,
	) {
		super(context, options);
		this._streamOptions = streamOptions;
	}

	get preload(): StreamPreload {
		return this._streamOptions.preload ?? "auto";
	}

	get metadata(): AudioMetadata | null {
		return this._metadata;
	}

	on<K extends keyof StreamingClipNodeEventMap>(
		event: K,
		callback: (...args: StreamingClipNodeEventMap[K]) => void,
	): void {
		super.on(event as keyof ClipNodeEventMap, callback as never);
	}

	off<K extends keyof StreamingClipNodeEventMap>(
		event: K,
		callback: (...args: StreamingClipNodeEventMap[K]) => void,
	): void {
		super.off(event as keyof ClipNodeEventMap, callback as never);
	}

	protected emit<K extends keyof StreamingClipNodeEventMap>(
		event: K,
		...args: StreamingClipNodeEventMap[K]
	): void {
		super.emit(event as keyof ClipNodeEventMap, ...(args as never));
	}

	onbufferchange?: (buffered: BufferedRange[]) => void;

	get readyState(): StreamReadyState {
		return this._readyState;
	}

	private _setReadyState(state: StreamReadyState): void {
		if (state === this._readyState) return;
		this._readyState = state;
		this.onreadystatechange?.(state);
		this.emit("readystatechange", state);
	}

	get buffered(): BufferedRange[] {
		const sr = this.context.sampleRate;
		return this._writtenSpans.map((s) => ({
			start: s.startSample / sr,
			end: s.endSample / sr,
		}));
	}

	get bufferedLength(): number {
		return this._committedLength / this.context.sampleRate;
	}

	protected override onBufferStateChanged(): void {
		this._finalizeDownloadedIfReady();

		const ranges = this.buffered;
		this.onbufferchange?.(ranges);
		this.emit("bufferchange", ranges);

		// Check backpressure on every buffer state update
		this._checkBackpressure();

		// If we were in a buffer underrun state (waiting), check if buffer recovered
		if (this._readyState === "loading" && this._readyToPlay) {
			this._setReadyState("canplay");
			this.oncanplay?.();
			this.emit("canplay");
		}

		// Estimate canplaythrough: if remaining download time < remaining playback time
		if (
			this._readyState === "canplay" &&
			this._streamTotalLength !== null &&
			this._totalBytesReceived > 0
		) {
			const elapsed = (performance.now() - this._streamStartTime) / 1000;
			if (elapsed > 0) {
				const bytesPerSecond = this._totalBytesReceived / elapsed;
				const sr = this.context.sampleRate;
				// Estimate total byte size relative to samples (bytes per sample ratio)
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
					this._setReadyState("canplaythrough");
					this.oncanplaythrough?.();
					this.emit("canplaythrough");
				}
			}
		}
	}

	protected override onBufferUnderrun(): void {
		if (
			this._readyState === "canplay" ||
			this._readyState === "canplaythrough"
		) {
			this._setReadyState("loading");
			this.onwaiting?.();
			this.emit("waiting");
		}
		// Ensure fetch is resumed on underrun
		this._checkBackpressure();
	}

	protected override onSeekStarted(targetSample: number): void {
		// Check if target is within already-buffered spans
		for (const span of this._writtenSpans) {
			if (targetSample >= span.startSample && targetSample < span.endSample) {
				// Target is in a buffered region - complete immediately
				this._completeSeeked();
				return;
			}
		}

		// Target is beyond buffered data - need to fetch from server
		if (!this._worker) {
			// No worker available - complete immediately (best effort)
			this._completeSeeked();
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

	private _checkBackpressure(): void {
		const pauseThreshold = this._streamOptions.pauseFetchAheadSamples ?? 0;
		if (pauseThreshold === 0 || !this._worker || this._streamDone) return;

		const resumeThreshold =
			this._streamOptions.resumeFetchAheadSamples ?? DEFAULT_RESUME_FETCH_AHEAD;
		const playheadSamples = Math.round(
			this.currentTime * this.context.sampleRate,
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

	/**
	 * A promise that resolves when the current stream download completes.
	 * Rejects if the stream encounters an error.
	 * Will not resolve until a URL is set and the stream finishes.
	 */
	get downloaded(): Promise<void> {
		return this._downloaded.promise;
	}

	get error(): StreamError | null {
		return this._lastError;
	}

	get url(): string | undefined {
		return this._url;
	}

	set url(value: string) {
		this._url = value;
		const preload = this._streamOptions.preload ?? "auto";
		if (preload === "none") {
			// Store URL but don't fetch - wait for start()
			return;
		}
		if (preload === "metadata") {
			// Only probe format/size via HEAD request, defer full fetch to start()
			this._probeMetadata(value);
			return;
		}
		// "auto" - fetch immediately
		this._startStream(value);
	}

	private async _probeMetadata(url: string): Promise<void> {
		try {
			const format =
				this._streamOptions.defaultFormat ??
				(await detectStreamFormatFromResponse(url));
			this._detectedFormat = format;
		} catch {
			// Metadata probe failed - full fetch on start() will retry
		}
	}

	private async _startStream(url: string): Promise<void> {
		this._streamStarting = true;
		if (this._streamOptions.useInt16) {
			console.warn(
				"StreamingClipNode: useInt16 is deprecated and has no effect. Float32 is always used for transfer to avoid audio-thread GC.",
			);
		}
		// Tear down any previous worker
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
		this._streamStartTime = performance.now();
		this._streamDoneAcked = false;

		this._setReadyState("loading");
		this.onloadstart?.();
		this.emit("loadstart");

		let format: StreamFormat;
		let worker: Worker;
		try {
			format =
				this._streamOptions.defaultFormat ??
				this._detectedFormat ??
				(await detectStreamFormatFromResponse(url));
			const workerFactory =
				this._streamOptions.createWorker ?? createStreamingWorker;
			worker = await workerFactory(format);
		} catch {
			this._streamStarting = false;
			return;
		}
		this._worker = worker;
		this._streamStarting = false;

		const channel = new MessageChannel();
		this.transferPort(channel.port2);

		const threshold =
			this._streamOptions.preBufferSamples ?? DEFAULT_PRE_BUFFER_SAMPLES;

		worker.onmessage = (ev: MessageEvent) => {
			const msg = ev.data as {
				type: string;
				bytesReceived?: number;
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
			};

			if (msg.type === "decoded") {
				this._tryStart(msg.samplesDecoded ?? 0, threshold);
				this._checkBackpressure();
			} else if (msg.type === "decodedRange") {
				this._applyDecodedRange(msg.startSample ?? 0, msg.endSample ?? 0);
			} else if (msg.type === "progress") {
				this._totalBytesReceived = msg.bytesReceived ?? 0;
				this.onprogress?.(this._totalBytesReceived);
				this.emit("progress", this._totalBytesReceived);
			} else if (msg.type === "retry") {
				const attempt = msg.attempt ?? 0;
				const delay = msg.delay ?? 0;
				const error = msg.error ?? "Unknown error";
				this.onretry?.(attempt, delay, error);
				this.emit("retry", attempt, delay, error);
			} else if (msg.type === "metadata" && msg.metadata) {
				this._metadata = msg.metadata;
				this.onmetadata?.(msg.metadata);
				this.emit("metadata", msg.metadata);
			} else if (msg.type === "done") {
				const completionSamples = this._resolveCompletionSamples(msg);
				// Redundantly finalize on the main-thread control port so totalLength is
				// correct even if the worker-side bufferEnd message arrives late.
				this.finalizeBuffer(completionSamples);
				this._streamDone = true;
				this._streamDoneAcked = true;
				// If the entire stream is shorter than the threshold, start now
				this._tryStart(completionSamples, 0);
				this._finalizeDownloadedIfReady();
				this.ondone?.();
				this.emit("done");
			} else if (msg.type === "seeked") {
				this._completeSeeked();
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
				this.onerror?.(error);
				this.emit("error", error);
			}
		};

		worker.postMessage(
			{
				type: "init",
				port: channel.port1,
				url,
				useInt16: this._streamOptions.useInt16 ?? false,
				targetSampleRate: this._streamOptions.targetSampleRate,
				retry:
					this._streamOptions.retry === false
						? null
						: (this._streamOptions.retry ?? null),
			},
			[channel.port1],
		);
	}

	/**
	 * Apply a decoded range from the decode worker to the main-thread written spans.
	 * This replaces the old writtenSpans tracking that was done on the audio thread.
	 */
	private _applyDecodedRange(startSample: number, endSample: number): void {
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
		const ranges = this.buffered;
		this.onbufferchange?.(ranges);
		this.emit("bufferchange", ranges);
	}

	private _resolveCompletionSamples(msg: {
		samplesDecoded?: number;
		totalSamples?: number;
	}): number {
		const declared = msg.samplesDecoded ?? msg.totalSamples ?? 0;
		if (!Number.isFinite(declared) || declared < 0) {
			return this._committedLength;
		}
		return Math.max(declared, this._committedLength);
	}

	private _finalizeDownloadedIfReady(): void {
		if (!this._streamDoneAcked) return;
		if (!this._streamEnded) return;
		this._setReadyState("complete");
		this._streamDoneAcked = false;
		this._worker?.terminate();
		this._worker = null;
		this._downloaded.resolve();
	}

	private _tryStart(samplesDecoded: number, threshold: number): void {
		if (this._readyToPlay) return;
		if (samplesDecoded < threshold && !this._streamDone) return;
		this._readyToPlay = true;

		// Transition readyState: loading -> canplay (unless stream is already complete)
		if (this._readyState === "loading") {
			this._setReadyState("canplay");
			this.oncanplay?.();
			this.emit("canplay");
		}

		if (this._pendingStart !== null) {
			const { when, offset, duration } = this._pendingStart;
			this._pendingStart = null;
			super.start(when, offset, duration);
		}
	}

	start(when?: number, offset?: number, duration?: number): void {
		// If preload deferred fetching, start the stream now
		if (
			this._url &&
			!this._worker &&
			!this._streamStarting &&
			!this._streamDone
		) {
			this._startStream(this._url);
		}
		if (this._readyToPlay || this._url === "") {
			// Enough data buffered (or no streaming URL set) - start immediately
			super.start(when, offset, duration);
		} else {
			// Defer until enough decoded data has been buffered
			this._pendingStart = { when, offset, duration };
		}
	}

	stop(when?: number): void {
		this._terminateWorker();
		super.stop(when);
	}

	dispose(): void {
		this._terminateWorker();
		this.onwaiting = undefined;
		this.oncanplay = undefined;
		this.oncanplaythrough = undefined;
		this.onloadstart = undefined;
		this.onreadystatechange = undefined;
		this.onbufferchange = undefined;
		this.onerror = undefined;
		this.onprogress = undefined;
		this.ondone = undefined;
		this.onretry = undefined;
		this.onmetadata = undefined;
		super.dispose();
	}

	private _terminateWorker(): void {
		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}
	}
}
