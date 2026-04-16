import type {
	EventFor,
	TypedEventListener,
} from "@jadujoel/typed-event-target";
import { TypedEventTarget } from "@jadujoel/typed-event-target";
import { ClipNode } from "./ClipNode";
import type { StreamingClipNodeOptions } from "./ClipStreamController";
import { ClipStreamController } from "./ClipStreamController";
import type {
	AudioMetadata,
	BufferedRange,
	ClipNodeEvents,
	ClipWorkletOptions,
	GapPlaybackStrategy,
	StreamError,
	StreamingClipNodeEvents,
	StreamPreload,
	StreamReadyState,
} from "./types";

export type {
	PendingStart,
	StreamingClipNodeOptions,
} from "./ClipStreamController";

type SHandler<K extends keyof StreamingClipNodeEvents> = TypedEventListener<
	EventFor<StreamingClipNodeEvents, K>
> | null;

export class StreamingClipNode extends ClipNode {
	private _controller: ClipStreamController;

	/** Type-safe access to the full streaming event target. */
	get streamEvents(): TypedEventTarget<StreamingClipNodeEvents> {
		return this.events as unknown as TypedEventTarget<StreamingClipNodeEvents>;
	}

	private _cbOnerror: SHandler<"error"> = null;
	private _cbOnprogress: SHandler<"progress"> = null;
	private _cbOndone: SHandler<"done"> = null;
	private _cbOnwaiting: SHandler<"waiting"> = null;
	private _cbOncanplay: SHandler<"canplay"> = null;
	private _cbOncanplaythrough: SHandler<"canplaythrough"> = null;
	private _cbOnloadstart: SHandler<"loadstart"> = null;
	private _cbOnreadystatechange: SHandler<"readystatechange"> = null;
	private _cbOnretry: SHandler<"retry"> = null;
	private _cbOnmetadata: SHandler<"metadata"> = null;
	private _cbOnbufferchange: SHandler<"bufferchange"> = null;

	// ---------------------------------------------------------------------------
	// Streaming callback setter/getter pairs
	// ---------------------------------------------------------------------------

	get onerror() {
		return this._cbOnerror;
	}
	set onerror(fn: SHandler<"error"> | undefined) {
		if (this._cbOnerror)
			this.streamEvents.removeEventListener("error", this._cbOnerror);
		this._cbOnerror = fn ?? null;
		if (fn) this.streamEvents.addEventListener("error", fn);
	}

	get onprogress() {
		return this._cbOnprogress;
	}
	set onprogress(fn: SHandler<"progress"> | undefined) {
		if (this._cbOnprogress)
			this.streamEvents.removeEventListener("progress", this._cbOnprogress);
		this._cbOnprogress = fn ?? null;
		if (fn) this.streamEvents.addEventListener("progress", fn);
	}

	get ondone() {
		return this._cbOndone;
	}
	set ondone(fn: SHandler<"done"> | undefined) {
		if (this._cbOndone)
			this.streamEvents.removeEventListener("done", this._cbOndone);
		this._cbOndone = fn ?? null;
		if (fn) this.streamEvents.addEventListener("done", fn);
	}

	get onwaiting() {
		return this._cbOnwaiting;
	}
	set onwaiting(fn: SHandler<"waiting"> | undefined) {
		if (this._cbOnwaiting)
			this.streamEvents.removeEventListener("waiting", this._cbOnwaiting);
		this._cbOnwaiting = fn ?? null;
		if (fn) this.streamEvents.addEventListener("waiting", fn);
	}

	get oncanplay() {
		return this._cbOncanplay;
	}
	set oncanplay(fn: SHandler<"canplay"> | undefined) {
		if (this._cbOncanplay)
			this.streamEvents.removeEventListener("canplay", this._cbOncanplay);
		this._cbOncanplay = fn ?? null;
		if (fn) this.streamEvents.addEventListener("canplay", fn);
	}

	get oncanplaythrough() {
		return this._cbOncanplaythrough;
	}
	set oncanplaythrough(fn: SHandler<"canplaythrough"> | undefined) {
		if (this._cbOncanplaythrough)
			this.streamEvents.removeEventListener(
				"canplaythrough",
				this._cbOncanplaythrough,
			);
		this._cbOncanplaythrough = fn ?? null;
		if (fn) this.streamEvents.addEventListener("canplaythrough", fn);
	}

	get onloadstart() {
		return this._cbOnloadstart;
	}
	set onloadstart(fn: SHandler<"loadstart"> | undefined) {
		if (this._cbOnloadstart)
			this.streamEvents.removeEventListener("loadstart", this._cbOnloadstart);
		this._cbOnloadstart = fn ?? null;
		if (fn) this.streamEvents.addEventListener("loadstart", fn);
	}

	get onreadystatechange() {
		return this._cbOnreadystatechange;
	}
	set onreadystatechange(fn: SHandler<"readystatechange"> | undefined) {
		if (this._cbOnreadystatechange)
			this.streamEvents.removeEventListener(
				"readystatechange",
				this._cbOnreadystatechange,
			);
		this._cbOnreadystatechange = fn ?? null;
		if (fn) this.streamEvents.addEventListener("readystatechange", fn);
	}

	get onretry() {
		return this._cbOnretry;
	}
	set onretry(fn: SHandler<"retry"> | undefined) {
		if (this._cbOnretry)
			this.streamEvents.removeEventListener("retry", this._cbOnretry);
		this._cbOnretry = fn ?? null;
		if (fn) this.streamEvents.addEventListener("retry", fn);
	}

	get onmetadata() {
		return this._cbOnmetadata;
	}
	set onmetadata(fn: SHandler<"metadata"> | undefined) {
		if (this._cbOnmetadata)
			this.streamEvents.removeEventListener("metadata", this._cbOnmetadata);
		this._cbOnmetadata = fn ?? null;
		if (fn) this.streamEvents.addEventListener("metadata", fn);
	}

	get onbufferchange() {
		return this._cbOnbufferchange;
	}
	set onbufferchange(fn: SHandler<"bufferchange"> | undefined) {
		if (this._cbOnbufferchange)
			this.streamEvents.removeEventListener(
				"bufferchange",
				this._cbOnbufferchange,
			);
		this._cbOnbufferchange = fn ?? null;
		if (fn) this.streamEvents.addEventListener("bufferchange", fn);
	}

	protected override _createEvents(): TypedEventTarget<ClipNodeEvents> {
		return TypedEventTarget.from<StreamingClipNodeEvents>() as unknown as TypedEventTarget<ClipNodeEvents>;
	}

	constructor(
		context: BaseAudioContext,
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
					this.streamEvents.dispatch("loadstart", {});
				},
				onCanPlay: () => {
					this.streamEvents.dispatch("canplay", {});
				},
				onCanPlayThrough: () => {
					this.streamEvents.dispatch("canplaythrough", {});
				},
				onWaiting: () => {
					this.streamEvents.dispatch("waiting", {});
				},
				onProgress: (bytesReceived) => {
					this.streamEvents.dispatch("progress", { bytesReceived });
				},
				onRetry: (attempt, delay, error) => {
					this.streamEvents.dispatch("retry", { attempt, delay, error });
				},
				onMetadata: (metadata) => {
					this.streamEvents.dispatch("metadata", { metadata });
				},
				onDone: () => {
					this.streamEvents.dispatch("done", {});
				},
				onError: (error) => {
					this.streamEvents.dispatch("error", { error });
				},
				onBufferChange: (buffered) => {
					this.streamEvents.dispatch("bufferchange", { buffered });
				},
				onReadyStateChange: (state) => {
					this.streamEvents.dispatch("readystatechange", { state });
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
		// Clear streaming callback references (events.dispose in super handles listener map)
		this._cbOnerror = null;
		this._cbOnprogress = null;
		this._cbOndone = null;
		this._cbOnwaiting = null;
		this._cbOncanplay = null;
		this._cbOncanplaythrough = null;
		this._cbOnloadstart = null;
		this._cbOnreadystatechange = null;
		this._cbOnretry = null;
		this._cbOnmetadata = null;
		this._cbOnbufferchange = null;
		super.dispose();
	}
}
