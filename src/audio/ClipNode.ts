import {
	type EventFor,
	type TypedEventListener,
	TypedEventTarget,
} from "@jadujoel/typed-event-target";
import type {
	ClipNodeEvents,
	ClipNodeState,
	ClipWorkletOptions,
	LoopMode,
	StreamBufferSpan,
} from "./types";
import { audioBufferFromFloat32Array } from "./utils";

type Handler<K extends keyof ClipNodeEvents> = TypedEventListener<
	EventFor<ClipNodeEvents, K>
> | null;

export class ClipNode extends AudioWorkletNode {
	readonly events: TypedEventTarget<ClipNodeEvents>;

	private _buffer?: AudioBuffer;
	private _loopStart = 0;
	private _loopEnd = 0;
	private _loop = false;
	private _loopMode: LoopMode = "forward";
	private _offset = 0;
	private _playhead = 0;
	private _fadeIn = 0;
	private _fadeOut = 0;
	private _loopCrossfade = 0;
	private _loopCrossfadeOffset = 0;
	private _duration = -1;
	private _previousState: ClipNodeState = "initial";
	private _bufferWriteCursor = 0;
	private _hasStreamingPort = false;
	private _muted = false;
	private _lastTimeUpdate = -Infinity;
	private _timeUpdateInterval = 250;
	protected _writtenSpans: StreamBufferSpan[] = [];
	protected _committedLength = 0;
	protected _streamTotalLength: number | null = null;
	protected _streamEnded = false;
	private _pendingGetBuffer: PromiseWithResolvers<AudioBuffer> | null = null;

	timesLooped = 0;
	state: ClipNodeState = "initial";
	cpu = 0;

	// ---------------------------------------------------------------------------
	// Callback setter/getter pairs — each delegates to `this.events`
	// ---------------------------------------------------------------------------

	get onscheduled() {
		return this.events.getCallback("scheduled");
	}
	set onscheduled(fn: Handler<"scheduled"> | undefined) {
		this.events.setCallback("scheduled", fn ?? null);
	}

	get onstarted() {
		return this.events.getCallback("started");
	}
	set onstarted(fn: Handler<"started"> | undefined) {
		this.events.setCallback("started", fn ?? null);
	}

	get onpaused() {
		return this.events.getCallback("paused");
	}
	set onpaused(fn: Handler<"paused"> | undefined) {
		this.events.setCallback("paused", fn ?? null);
	}

	get onresumed() {
		return this.events.getCallback("resumed");
	}
	set onresumed(fn: Handler<"resumed"> | undefined) {
		this.events.setCallback("resumed", fn ?? null);
	}

	get onended() {
		return this.events.getCallback("ended");
	}
	set onended(fn: Handler<"ended"> | undefined) {
		this.events.setCallback("ended", fn ?? null);
	}

	get onlooped() {
		return this.events.getCallback("looped");
	}
	set onlooped(fn: Handler<"looped"> | undefined) {
		this.events.setCallback("looped", fn ?? null);
	}

	get onstopped() {
		return this.events.getCallback("stopped");
	}
	set onstopped(fn: Handler<"stopped"> | undefined) {
		this.events.setCallback("stopped", fn ?? null);
	}

	get onframe() {
		return this.events.getCallback("frame");
	}
	set onframe(fn: Handler<"frame"> | undefined) {
		this.events.setCallback("frame", fn ?? null);
		this._updateFrameReporting();
	}

	get ondisposed() {
		return this.events.getCallback("disposed");
	}
	set ondisposed(fn: Handler<"disposed"> | undefined) {
		this.events.setCallback("disposed", fn ?? null);
	}

	get onstatechange() {
		return this.events.getCallback("statechange");
	}
	set onstatechange(fn: Handler<"statechange"> | undefined) {
		this.events.setCallback("statechange", fn ?? null);
	}

	get ondurationchange() {
		return this.events.getCallback("durationchange");
	}
	set ondurationchange(fn: Handler<"durationchange"> | undefined) {
		this.events.setCallback("durationchange", fn ?? null);
	}

	get onratechange() {
		return this.events.getCallback("ratechange");
	}
	set onratechange(fn: Handler<"ratechange"> | undefined) {
		this.events.setCallback("ratechange", fn ?? null);
	}

	get onseeking() {
		return this.events.getCallback("seeking");
	}
	set onseeking(fn: Handler<"seeking"> | undefined) {
		this.events.setCallback("seeking", fn ?? null);
	}

	get onseeked() {
		return this.events.getCallback("seeked");
	}
	set onseeked(fn: Handler<"seeked"> | undefined) {
		this.events.setCallback("seeked", fn ?? null);
	}

	get ontimeupdate() {
		return this.events.getCallback("timeupdate");
	}
	set ontimeupdate(fn: Handler<"timeupdate"> | undefined) {
		this.events.setCallback("timeupdate", fn ?? null);
		this._updateFrameReporting();
	}

	private _updateFrameReporting(): void {
		const needed =
			this.events.hasListeners("frame") ||
			this.events.hasListeners("timeupdate");
		this.port.postMessage({ type: "enableFrameReporting", data: needed });
	}

	get timeUpdateInterval(): number {
		return this._timeUpdateInterval;
	}
	set timeUpdateInterval(ms: number) {
		this._timeUpdateInterval = Math.max(0, ms);
	}

	constructor(context: BaseAudioContext, options: ClipWorkletOptions = {}) {
		super(context, "ClipProcessor", {
			numberOfInputs: options.numberOfInputs ?? 0,
			outputChannelCount: options.outputChannelCount ?? [2],
			processorOptions: options.processorOptions,
			channelCount: options.channelCount,
			channelCountMode: options.channelCountMode,
			channelInterpretation: options.channelInterpretation,
			numberOfOutputs: options.numberOfOutputs,
			parameterData: options.parameterData,
		});

		this.events = this._createEvents();
		this._buffer = audioBufferFromFloat32Array(
			this.context,
			options.processorOptions?.buffer,
		);
		this.port.onmessage = this.handleMessage;
	}

	protected _createEvents(): TypedEventTarget<ClipNodeEvents> {
		return TypedEventTarget.from<ClipNodeEvents>();
	}

	private handleMessage = (message: MessageEvent) => {
		const { type, data } = message.data;
		switch (type) {
			case "frame": {
				const [_ct, _cf, ph, tt] = data as [number, number, number, number];
				this._playhead = ph;
				this.cpu = tt;
				this.events.dispatch("frame", { data });
				if (this.events.hasListeners("timeupdate")) {
					const now = performance.now();
					if (now - this._lastTimeUpdate >= this._timeUpdateInterval) {
						this._lastTimeUpdate = now;
						this.events.dispatch("timeupdate", {
							currentTime: this.currentTime,
						});
					}
				}
				break;
			}
			case "scheduled":
				this.setState("scheduled");
				this.events.dispatch("scheduled", {});
				break;
			case "started":
				this.setState("started");
				this.events.dispatch("started", {});
				break;
			case "stopped":
				this.setState("stopped");
				this.events.dispatch("stopped", {});
				break;
			case "paused":
				this.setState("paused");
				this.events.dispatch("paused", {});
				break;
			case "resume":
				this.setState("resumed");
				this.events.dispatch("resumed", {});
				break;
			case "ended":
				this.setState("ended");
				this.events.dispatch("ended", {});
				break;
			case "looped":
				this.timesLooped++;
				this.events.dispatch("looped", {});
				break;
			case "bufferState": {
				const bs = data as {
					committedLength: number;
					totalLength: number | null;
					streamEnded: boolean;
					writtenSpans?: StreamBufferSpan[];
				};
				this._committedLength = bs.committedLength;
				this._streamTotalLength = bs.totalLength;
				this._streamEnded = bs.streamEnded;
				if (Array.isArray(bs.writtenSpans)) {
					this._writtenSpans = bs.writtenSpans;
				}
				this.onBufferStateChanged();
				break;
			}
			case "bufferUnderrun":
				this.onBufferUnderrun();
				break;
			case "bufferLowWater":
				this.onBufferLowWater();
				break;
			case "bufferData": {
				const channelData = data as Float32Array[];
				if (this._pendingGetBuffer) {
					const pending = this._pendingGetBuffer;
					this._pendingGetBuffer = null;
					if (
						!channelData ||
						channelData.length === 0 ||
						channelData[0].length === 0
					) {
						pending.reject(new Error("No decoded buffer available"));
					} else {
						const ab = this.context.createBuffer(
							channelData.length,
							channelData[0].length,
							this.context.sampleRate,
						);
						for (let ch = 0; ch < channelData.length; ch++) {
							ab.getChannelData(ch).set(channelData[ch]);
						}
						pending.resolve(ab);
					}
				}
				break;
			}
			case "disposed":
				this.setState("disposed");
				break;
		}
	};

	protected onBufferStateChanged(): void {
		// Hook for subclasses (StreamingClipNode) to react to buffer state changes
	}

	protected onBufferUnderrun(): void {
		// Hook for subclasses
	}

	protected onBufferLowWater(): void {
		// Hook for subclasses
	}

	/**
	 * Called when a seek is initiated. For non-streaming ClipNode, the seek
	 * completes immediately since all data is in the buffer.
	 * Subclasses (StreamingClipNode) override to handle range-request seeks.
	 */
	protected onSeekStarted(_targetSample: number): void {
		this._completeSeeked();
	}

	protected _completeSeeked(): void {
		if (!this._seeking) return;
		this._seeking = false;
		this.events.dispatch("seeked", {});
	}

	private setState(newState: ClipNodeState) {
		this._previousState = this.state;
		this.state = newState;
		if (this.state !== this._previousState) {
			this.events.dispatch("statechange", { state: this.state });
		}
	}

	toggleGain(value = true) {
		this.port.postMessage({ type: "toggleGain", data: value });
	}
	togglePlaybackRate(value = true) {
		this.port.postMessage({ type: "togglePlaybackRate", data: value });
	}
	toggleDetune(value = true) {
		this.port.postMessage({ type: "toggleDetune", data: value });
	}
	togglePan(value = true) {
		this.port.postMessage({ type: "togglePan", data: value });
	}
	toggleHighpass(value = true) {
		this.port.postMessage({ type: "toggleHighpass", data: value });
	}
	toggleLowpass(value = true) {
		this.port.postMessage({ type: "toggleLowpass", data: value });
	}
	toggleFadeIn(value = true) {
		this.port.postMessage({ type: "toggleFadeIn", data: value });
	}
	toggleFadeOut(value = true) {
		this.port.postMessage({ type: "toggleFadeOut", data: value });
	}
	toggleLoopCrossfade(value = true) {
		this.port.postMessage({ type: "toggleLoopCrossfade", data: value });
	}
	toggleLoopStart(value = true) {
		this.port.postMessage({ type: "toggleLoopStart", data: value });
	}
	toggleLoopEnd(value = true) {
		this.port.postMessage({ type: "toggleLoopEnd", data: value });
	}
	logState() {
		this.port.postMessage({ type: "logState" });
	}

	get buffer(): AudioBuffer | undefined {
		return this._buffer;
	}
	set buffer(ab: AudioBuffer) {
		this.throwIfDisposed();
		this._buffer = ab;
		this._bufferWriteCursor = ab.length;
		if (this._loopStart >= ab.duration) {
			this._loopStart = 0;
		}
		if (this._loopEnd <= this._loopStart || this._loopEnd > ab.duration) {
			this._loopEnd = ab.duration;
		}
		const data =
			ab.numberOfChannels === 1
				? [ab.getChannelData(0)]
				: [ab.getChannelData(0), ab.getChannelData(1)];
		this.port.postMessage({ type: "buffer", data });
		this.port.postMessage({ type: "loopStart", data: this._loopStart });
		this.port.postMessage({ type: "loopEnd", data: this._loopEnd });
		const newDuration = ab.duration;
		if (this._duration !== newDuration) {
			this._duration = newDuration;
			this.events.dispatch("durationchange", { duration: newDuration });
		}
	}

	transferPort(port: MessagePort) {
		this._hasStreamingPort = true;
		this.port.postMessage({ type: "transferPort", data: port }, [port]);
	}

	initializeBuffer(
		totalLength: number,
		channels: number,
		options: { streaming?: boolean } = {},
	) {
		this._buffer = this.context.createBuffer(
			channels,
			totalLength,
			this.context.sampleRate,
		);
		this._bufferWriteCursor = 0;
		const duration = totalLength / this.context.sampleRate;
		if (this._loopStart >= duration) {
			this._loopStart = 0;
		}
		if (this._loopEnd <= this._loopStart || this._loopEnd > duration) {
			this._loopEnd = duration;
		}
		this.port.postMessage({
			type: "bufferInit",
			data: {
				channels,
				totalLength,
				streaming: options.streaming ?? true,
			},
		});
		this.port.postMessage({ type: "loopStart", data: this._loopStart });
		this.port.postMessage({ type: "loopEnd", data: this._loopEnd });
	}

	replaceBufferRange(
		startSample: number,
		channelData: Float32Array[],
		options: { totalLength?: number | null; streamEnded?: boolean } = {},
	) {
		this.port.postMessage({
			type: "bufferRange",
			data: {
				startSample,
				channelData,
				totalLength: options.totalLength,
				streamEnded: options.streamEnded,
			},
		});
		this._bufferWriteCursor = Math.max(
			this._bufferWriteCursor,
			startSample + (channelData[0]?.length ?? 0),
		);
	}

	appendBufferRange(
		channelData: Float32Array[],
		options: { totalLength?: number | null; streamEnded?: boolean } = {},
	) {
		this.replaceBufferRange(this._bufferWriteCursor, channelData, options);
	}

	finalizeBuffer(totalLength?: number) {
		this.port.postMessage({ type: "bufferEnd", data: { totalLength } });
	}

	start(when?: number, offset?: number, duration?: number): undefined | never {
		this.throwIfDisposed();
		if (!this._buffer && !this._hasStreamingPort) {
			console.error("Buffer not set.");
			return;
		}
		this.port.postMessage({ type: "start", data: { when, offset, duration } });
	}

	stop(
		when: number = this.context.currentTime,
		initialDelay = 0,
	): undefined | never {
		this.throwIfDisposed();
		this.port.postMessage({
			type: "stop",
			data: when + initialDelay + this._fadeOut + 0.2,
		});
	}

	pause(when: number = this.context.currentTime): undefined | never {
		this.throwIfDisposed();
		this.port.postMessage({ type: "pause", data: when });
	}

	resume(when: number = this.context.currentTime): undefined | never {
		this.throwIfDisposed();
		this.port.postMessage({ type: "resume", data: when });
	}

	get loop() {
		return this._loop;
	}
	set loop(value: boolean) {
		if (this._loop !== value) {
			this._loop = value;
			this.port.postMessage({ type: "loop", data: value });
		}
	}

	get loopMode(): LoopMode {
		return this._loopMode;
	}
	set loopMode(value: LoopMode) {
		if (this._loopMode !== value) {
			this._loopMode = value;
			this.port.postMessage({ type: "loopMode", data: value });
		}
	}

	get loopStart() {
		return this._loopStart;
	}
	set loopStart(value: number) {
		if (value !== this._loopStart) {
			this._loopStart = value;
			this.port.postMessage({ type: "loopStart", data: value });
		}
	}

	get loopEnd() {
		return this._loopEnd;
	}
	set loopEnd(value: number) {
		if (value !== this._loopEnd) {
			this._loopEnd = value;
			this.port.postMessage({ type: "loopEnd", data: value });
		}
	}

	get duration() {
		return this._duration ?? this._buffer?.duration ?? -1;
	}
	set duration(value: number) {
		if (this._duration !== value) {
			this._duration = value;
			this.events.dispatch("durationchange", { duration: value });
		}
	}

	get offset() {
		return this._offset;
	}
	set offset(value: number) {
		this._offset = value;
	}

	private _seeking = false;

	get seeking(): boolean {
		return this._seeking;
	}

	get playhead() {
		return this._playhead;
	}
	set playhead(value: number) {
		this.throwIfDisposed();
		this._seeking = true;
		this.events.dispatch("seeking", {});
		this.port.postMessage({ type: "playhead", data: value });
		this.onSeekStarted(value);
	}

	get currentTime(): number {
		return this._playhead / this.context.sampleRate;
	}
	set currentTime(seconds: number) {
		this.playhead = Math.round(seconds * this.context.sampleRate);
	}

	get playbackRate(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("playbackRate")!;
	}

	setPlaybackRate(value: number): void {
		this.playbackRate.value = value;
		this.events.dispatch("ratechange", { rate: value });
	}
	get detune(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("detune")!;
	}
	get highpass(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("highpass")!;
	}
	get lowpass(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("lowpass")!;
	}
	get gain(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("gain")!;
	}
	get pan(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: it is definitely set in the processor
		return this.parameters.get("pan")!;
	}

	get muted(): boolean {
		return this._muted;
	}
	set muted(value: boolean) {
		if (value === this._muted) return;
		this._muted = value;
		this.port.postMessage({ type: "mute", data: value });
	}

	get fadeIn() {
		return this._fadeIn;
	}
	set fadeIn(value: number) {
		this._fadeIn = value;
		this.port.postMessage({ type: "fadeIn", data: value });
	}

	get fadeOut() {
		return this._fadeOut;
	}

	set fadeOut(value: number) {
		this._fadeOut = value;
		this.port.postMessage({ type: "fadeOut", data: value });
	}

	get loopCrossfade() {
		return this._loopCrossfade;
	}
	set loopCrossfade(value: number) {
		this._loopCrossfade = value;
		this.port.postMessage({ type: "loopCrossfade", data: value });
	}

	get loopCrossfadeOffset() {
		return this._loopCrossfadeOffset;
	}
	set loopCrossfadeOffset(value: number) {
		this._loopCrossfadeOffset = Math.max(-1, Math.min(1, value));
		this.port.postMessage({
			type: "loopCrossfadeOffset",
			data: this._loopCrossfadeOffset,
		});
	}

	protected throwIfDisposed(): undefined | never {
		if (this.state === "disposed") {
			throw new Error("Cannot use a disposed ClipNode");
		}
	}

	/**
	 * Request a copy of the decoded audio buffer from the processor.
	 * The buffer is only copied when this method is called, not cached.
	 * Returns a Promise that resolves with an AudioBuffer containing the decoded data.
	 */
	getDecodedBuffer(): Promise<AudioBuffer | never> {
		this.throwIfDisposed();
		if (this._pendingGetBuffer) {
			return this._pendingGetBuffer.promise;
		}
		this._pendingGetBuffer = Promise.withResolvers<AudioBuffer>();
		this.port.postMessage({ type: "getBuffer" });
		return this._pendingGetBuffer.promise;
	}

	dispose() {
		if (this.state === "disposed") return;
		if (this._pendingGetBuffer) {
			this._pendingGetBuffer.reject(new Error("Node was disposed"));
			this._pendingGetBuffer = null;
		}
		this.port.postMessage({ type: "dispose" });
		this.port.close();
		this.events.dispatch("disposed", {});
		this._buffer = undefined;
		this._writtenSpans = [];
		this._committedLength = 0;
		this._streamTotalLength = null;
		this._streamEnded = false;
		// Clear all callback references (events.dispose clears the listener map and callbacks)
		this.events.dispose();
		this.state = "disposed";
	}
}
