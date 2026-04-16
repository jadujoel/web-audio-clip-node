import { ClipNode } from "./ClipNode";
import type { StreamingClipNodeOptions } from "./ClipStreamController";
import { ClipStreamController } from "./ClipStreamController";
import type {
	AudioMetadata,
	BufferedRange,
	ClipNodeEventMap,
	ClipWorkletOptions,
	GapPlaybackStrategy,
	StreamError,
	StreamingClipNodeEventMap,
	StreamPreload,
	StreamReadyState,
} from "./types";

export type {
	PendingStart,
	StreamingClipNodeOptions,
} from "./ClipStreamController";

export class StreamingClipNode extends ClipNode {
	private _controller: ClipStreamController;

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
	onbufferchange?: (buffered: BufferedRange[]) => void;

	constructor(
		public context: BaseAudioContext,
		options: ClipWorkletOptions = {},
		streamOptions: StreamingClipNodeOptions,
	) {
		super(context, options);
		const thisNode = this;
		this._controller = new ClipStreamController(
			{
				context,
				get currentTime() {
					return thisNode.currentTime;
				},
				transferPort: (port) => this.transferPort(port),
				finalizeBuffer: (totalLength) => this.finalizeBuffer(totalLength),
				startPlayback: (when, offset, duration) => {
					ClipNode.prototype.start.call(this, when, offset, duration);
				},
				postProcessorMessage: (message) => this.port.postMessage(message),
				setDuration: (duration) => {
					this.duration = duration;
				},
				completeSeek: () => this._completeSeeked(),
				onLoadStart: () => {
					this.onloadstart?.();
					this.emit("loadstart");
				},
				onCanPlay: () => {
					this.oncanplay?.();
					this.emit("canplay");
				},
				onCanPlayThrough: () => {
					this.oncanplaythrough?.();
					this.emit("canplaythrough");
				},
				onWaiting: () => {
					this.onwaiting?.();
					this.emit("waiting");
				},
				onProgress: (bytesReceived) => {
					this.onprogress?.(bytesReceived);
					this.emit("progress", bytesReceived);
				},
				onRetry: (attempt, delay, error) => {
					this.onretry?.(attempt, delay, error);
					this.emit("retry", attempt, delay, error);
				},
				onMetadata: (metadata) => {
					this.onmetadata?.(metadata);
					this.emit("metadata", metadata);
				},
				onDone: () => {
					this.ondone?.();
					this.emit("done");
				},
				onError: (error) => {
					this.onerror?.(error);
					this.emit("error", error);
				},
				onBufferChange: (buffered) => {
					this.onbufferchange?.(buffered);
					this.emit("bufferchange", buffered);
				},
				onReadyStateChange: (state) => {
					this.onreadystatechange?.(state);
					this.emit("readystatechange", state);
				},
			},
			streamOptions,
		);
	}

	get gapPlaybackStrategy(): GapPlaybackStrategy {
		return this._controller.gapPlaybackStrategy;
	}

	set gapPlaybackStrategy(value: GapPlaybackStrategy) {
		this.throwIfDisposed();
		this._controller.gapPlaybackStrategy = value;
	}

	get targetNumSamples(): number | undefined {
		return this._controller.targetNumSamples;
	}

	set targetNumSamples(value: number | undefined) {
		this.throwIfDisposed();
		this._controller.targetNumSamples = value;
	}

	get targetDuration(): number | undefined {
		return this._controller.targetDuration;
	}

	set targetDuration(value: number | undefined) {
		this.throwIfDisposed();
		this._controller.targetDuration = value;
	}

	get gapRecoveryFadeSamples(): number {
		return this._controller.gapRecoveryFadeSamples;
	}

	set gapRecoveryFadeSamples(value: number) {
		this.throwIfDisposed();
		this._controller.gapRecoveryFadeSamples = value;
	}

	get preload(): StreamPreload {
		return this._controller.preload;
	}

	get throttle(): number {
		return this._controller.throttle;
	}

	set throttle(value: number) {
		this.throwIfDisposed();
		this._controller.throttle = value;
	}

	get metadata(): AudioMetadata | null {
		return this._controller.metadata;
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

	get readyState(): StreamReadyState {
		return this._controller.readyState;
	}

	get buffered(): BufferedRange[] {
		return this._controller.buffered;
	}

	get bufferedLength(): number {
		return this._controller.bufferedLength;
	}

	protected override onBufferStateChanged(): void {
		this._controller.handleBufferStateChanged({
			writtenSpans: this._writtenSpans,
			committedLength: this._committedLength,
			streamTotalLength: this._streamTotalLength,
			streamEnded: this._streamEnded,
		});
	}

	protected override onBufferUnderrun(): void {
		this._controller.handleBufferUnderrun();
	}

	protected override onSeekStarted(targetSample: number): void {
		this._controller.handleSeekStarted(targetSample);
	}

	get downloaded(): Promise<void> {
		return this._controller.downloaded;
	}

	get error(): StreamError | null {
		return this._controller.error;
	}

	get url(): string | undefined {
		return this._controller.url;
	}

	set url(value: string) {
		this.throwIfDisposed();
		this._controller.setUrl(value);
	}

	start(when?: number, offset?: number, duration?: number): void {
		this.throwIfDisposed();
		this._controller.start(when, offset, duration);
	}

	stop(when?: number, initialDelay = 0): void {
		this.throwIfDisposed();
		this._controller.stop();
		super.stop(when, initialDelay);
	}

	dispose(): void {
		if (this.state === "disposed") return;
		this._controller.dispose();
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
}
