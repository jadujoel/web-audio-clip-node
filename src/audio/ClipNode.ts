import type {
	ClipNodeEventMap,
	ClipNodeState,
	ClipWorkletOptions,
	FrameData,
	LoopMode,
	StreamBufferSpan,
} from "./types";
import { audioBufferFromFloat32Array } from "./utils";

type EventCallback = (...args: unknown[]) => void;

export class ClipNode extends AudioWorkletNode {
	onscheduled?: () => void;
	onstarted?: () => void;
	onpaused?: () => void;
	onresumed?: () => void;
	onended?: () => void;
	onlooped?: () => void;
	onstopped?: () => void;
	private _onframe?: (data: FrameData) => void;
	ondisposed?: () => void;
	onstatechange?: (state: ClipNodeState) => void;
	ondurationchange?: (duration: number) => void;
	onratechange?: (rate: number) => void;
	onseeking?: () => void;
	onseeked?: () => void;

	private _listeners = new Map<string, Set<EventCallback>>();

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
	private _ontimeupdate?: (currentTime: number) => void;
	private _lastTimeUpdate = -Infinity;
	private _timeUpdateInterval = 250;
	protected _writtenSpans: StreamBufferSpan[] = [];
	protected _committedLength = 0;
	protected _streamTotalLength: number | null = null;
	protected _streamEnded = false;

	timesLooped = 0;
	state: ClipNodeState = "initial";
	cpu = 0;

	get onframe(): ((data: FrameData) => void) | undefined {
		return this._onframe;
	}
	set onframe(cb: ((data: FrameData) => void) | undefined) {
		const hadCallback = !!this._onframe;
		this._onframe = cb;
		const hasCallback = !!cb;
		if (hadCallback !== hasCallback) {
			this.port.postMessage({
				type: "enableFrameReporting",
				data: hasCallback,
			});
		}
	}

	get ontimeupdate(): ((currentTime: number) => void) | undefined {
		return this._ontimeupdate;
	}
	set ontimeupdate(cb: ((currentTime: number) => void) | undefined) {
		this._ontimeupdate = cb;
		// Auto-enable frame reporting if setting a callback and it's not already on
		if (cb && !this._onframe) {
			this.port.postMessage({
				type: "enableFrameReporting",
				data: true,
			});
		}
	}

	get timeUpdateInterval(): number {
		return this._timeUpdateInterval;
	}
	set timeUpdateInterval(ms: number) {
		this._timeUpdateInterval = Math.max(0, ms);
	}

	constructor(
		public context: BaseAudioContext,
		options: ClipWorkletOptions = {},
	) {
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

		this._buffer = audioBufferFromFloat32Array(
			this.context,
			options.processorOptions?.buffer,
		);
		this.port.onmessage = this.handleMessage;
	}

	on<K extends keyof ClipNodeEventMap>(
		event: K,
		callback: (...args: ClipNodeEventMap[K]) => void,
	): void {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, new Set());
		}
		this._listeners.get(event)?.add(callback as EventCallback);
	}

	off<K extends keyof ClipNodeEventMap>(
		event: K,
		callback: (...args: ClipNodeEventMap[K]) => void,
	): void {
		this._listeners.get(event)?.delete(callback as EventCallback);
	}

	protected emit<K extends keyof ClipNodeEventMap>(
		event: K,
		...args: ClipNodeEventMap[K]
	): void {
		for (const fn of this._listeners.get(event) ?? []) fn(...args);
	}

	private handleMessage = (message: MessageEvent) => {
		const { type, data } = message.data;
		switch (type) {
			case "frame": {
				const [_ct, _cf, ph, tt] = data as [number, number, number, number];
				this._playhead = ph;
				this.cpu = tt;
				this._onframe?.(data);
				this.emit("frame", data);
				if (this._ontimeupdate) {
					const now = performance.now();
					if (now - this._lastTimeUpdate >= this._timeUpdateInterval) {
						this._lastTimeUpdate = now;
						const ct = this.currentTime;
						this._ontimeupdate(ct);
						this.emit("timeupdate", ct);
					}
				}
				break;
			}
			case "scheduled":
				this.setState("scheduled");
				this.onscheduled?.();
				this.emit("scheduled");
				break;
			case "started":
				this.setState("started");
				this.onstarted?.();
				this.emit("started");
				break;
			case "stopped":
				this.setState("stopped");
				this.onstopped?.();
				this.emit("stopped");
				break;
			case "paused":
				this.setState("paused");
				this.onpaused?.();
				this.emit("paused");
				break;
			case "resume":
				this.setState("resumed");
				this.onresumed?.();
				this.emit("resumed");
				break;
			case "ended":
				this.setState("ended");
				this.onended?.();
				this.emit("ended");
				break;
			case "looped":
				this.timesLooped++;
				this.onlooped?.();
				this.emit("looped");
				break;
			case "bufferState": {
				const bs = data as {
					committedLength: number;
					totalLength: number | null;
					streamEnded: boolean;
					writtenSpans: StreamBufferSpan[];
				};
				this._writtenSpans = bs.writtenSpans;
				this._committedLength = bs.committedLength;
				this._streamTotalLength = bs.totalLength;
				this._streamEnded = bs.streamEnded;
				this.onBufferStateChanged();
				break;
			}
			case "bufferUnderrun":
				this.onBufferUnderrun();
				break;
			case "bufferLowWater":
				this.onBufferLowWater();
				break;
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
		this.onseeked?.();
		this.emit("seeked");
	}

	private setState(newState: ClipNodeState) {
		this._previousState = this.state;
		this.state = newState;
		if (this.state !== this._previousState) {
			this.onstatechange?.(this.state);
			this.emit("statechange", this.state);
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
			this.ondurationchange?.(newDuration);
			this.emit("durationchange", newDuration);
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

	start(when?: number, offset?: number, duration?: number) {
		if (!this._buffer && !this._hasStreamingPort) {
			console.error("Buffer not set.");
			return;
		}
		this.port.postMessage({ type: "start", data: { when, offset, duration } });
	}

	stop(when: number = this.context.currentTime, initialDelay = 0) {
		this.port.postMessage({
			type: "stop",
			data: when + initialDelay + this._fadeOut + 0.2,
		});
	}

	pause(when: number = this.context.currentTime) {
		this.port.postMessage({ type: "pause", data: when });
	}

	resume(when: number = this.context.currentTime) {
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
			this.ondurationchange?.(value);
			this.emit("durationchange", value);
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
		this._seeking = true;
		this.onseeking?.();
		this.emit("seeking");
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
		this.onratechange?.(value);
		this.emit("ratechange", value);
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

	dispose() {
		this.port.postMessage({ type: "dispose" });
		this.port.close();
		this.ondisposed?.();
		this.emit("disposed");
		this._buffer = undefined;
		this.onended = undefined;
		this._onframe = undefined;
		this.onlooped = undefined;
		this.onpaused = undefined;
		this.onresumed = undefined;
		this.onstarted = undefined;
		this.onstopped = undefined;
		this.onscheduled = undefined;
		this.onstatechange = undefined;
		this.ondurationchange = undefined;
		this.onratechange = undefined;
		this.onseeking = undefined;
		this.onseeked = undefined;
		this._ontimeupdate = undefined;
		this.ondisposed = undefined;
		this._listeners.clear();
		this.state = "disposed";
	}
}
