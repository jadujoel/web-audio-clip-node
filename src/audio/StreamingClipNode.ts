import type {
	EventFor,
	TypedEventListener,
} from "@jadujoel/typed-event-target";
import { TypedEventTarget } from "@jadujoel/typed-event-target";
import { err, ok, type Result } from "neverthrow";
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

	// ---------------------------------------------------------------------------
	// Streaming callback setter/getter pairs
	// ---------------------------------------------------------------------------

	get onerror() {
		return this.streamEvents.getCallback("error");
	}
	set onerror(fn: SHandler<"error"> | undefined) {
		this.streamEvents.setCallback("error", fn ?? null);
	}

	get onprogress() {
		return this.streamEvents.getCallback("progress");
	}
	set onprogress(fn: SHandler<"progress"> | undefined) {
		this.streamEvents.setCallback("progress", fn ?? null);
	}

	get ondone() {
		return this.streamEvents.getCallback("done");
	}
	set ondone(fn: SHandler<"done"> | undefined) {
		this.streamEvents.setCallback("done", fn ?? null);
	}

	get onwaiting() {
		return this.streamEvents.getCallback("waiting");
	}
	set onwaiting(fn: SHandler<"waiting"> | undefined) {
		this.streamEvents.setCallback("waiting", fn ?? null);
	}

	get oncanplay() {
		return this.streamEvents.getCallback("canplay");
	}
	set oncanplay(fn: SHandler<"canplay"> | undefined) {
		this.streamEvents.setCallback("canplay", fn ?? null);
	}

	get oncanplaythrough() {
		return this.streamEvents.getCallback("canplaythrough");
	}
	set oncanplaythrough(fn: SHandler<"canplaythrough"> | undefined) {
		this.streamEvents.setCallback("canplaythrough", fn ?? null);
	}

	get onloadstart() {
		return this.streamEvents.getCallback("loadstart");
	}
	set onloadstart(fn: SHandler<"loadstart"> | undefined) {
		this.streamEvents.setCallback("loadstart", fn ?? null);
	}

	get onreadystatechange() {
		return this.streamEvents.getCallback("readystatechange");
	}
	set onreadystatechange(fn: SHandler<"readystatechange"> | undefined) {
		this.streamEvents.setCallback("readystatechange", fn ?? null);
	}

	get onretry() {
		return this.streamEvents.getCallback("retry");
	}
	set onretry(fn: SHandler<"retry"> | undefined) {
		this.streamEvents.setCallback("retry", fn ?? null);
	}

	get onmetadata() {
		return this.streamEvents.getCallback("metadata");
	}
	set onmetadata(fn: SHandler<"metadata"> | undefined) {
		this.streamEvents.setCallback("metadata", fn ?? null);
	}

	get onbufferchange() {
		return this.streamEvents.getCallback("bufferchange");
	}
	set onbufferchange(fn: SHandler<"bufferchange"> | undefined) {
		this.streamEvents.setCallback("bufferchange", fn ?? null);
	}

	protected override _createEvents(): TypedEventTarget<ClipNodeEvents> {
		return TypedEventTarget.from<StreamingClipNodeEvents>() as unknown as TypedEventTarget<ClipNodeEvents>;
	}

	constructor(
		context: BaseAudioContext,
		options: ClipWorkletOptions | undefined = {},
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
		if (this.isDisposed) return;
		this._controller.gapPlaybackStrategy = value;
	}

	get targetNumSamples(): number | undefined {
		return this._controller.targetNumSamples;
	}

	set targetNumSamples(value: number | undefined) {
		if (this.isDisposed) return;
		this._controller.targetNumSamples = value;
	}

	get targetDuration(): number | undefined {
		return this._controller.targetDuration;
	}

	set targetDuration(value: number | undefined) {
		if (this.isDisposed) return;
		this._controller.targetDuration = value;
	}

	get gapRecoveryFadeSamples(): number {
		return this._controller.gapRecoveryFadeSamples;
	}

	set gapRecoveryFadeSamples(value: number) {
		if (this.isDisposed) return;
		this._controller.gapRecoveryFadeSamples = value;
	}

	get preload(): StreamPreload {
		return this._controller.preload;
	}

	get throttle(): number {
		return this._controller.throttle;
	}

	set throttle(value: number) {
		if (this.isDisposed) return;
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
		if (this.isDisposed) return;
		this._controller.setUrl(value);
	}

	override start(
		when?: number,
		offset?: number,
		duration?: number,
	): Result<undefined, Error> {
		if (this.isDisposed) {
			return err(new Error(ClipNode.ErrorMessages.disposed));
		}
		this._controller.start(when, offset, duration);
		return ok(undefined);
	}

	override stop(when?: number, initialDelay = 0): Result<undefined, Error> {
		if (this.isDisposed) {
			return err(new Error(ClipNode.ErrorMessages.disposed));
		}
		this._controller.stop();
		return super.stop(when, initialDelay);
	}

	override dispose(): void {
		if (this.state === "disposed") {
			return;
		}
		this._controller.dispose();
		super.dispose();
	}
}
