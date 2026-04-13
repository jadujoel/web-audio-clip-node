import type { StreamFormat } from "../streaming";
import { createStreamingWorker, detectStreamFormat } from "../streaming";
import { ClipNode } from "./ClipNode";
import type { ClipWorkletOptions } from "./types";
import { getProcessorBlobUrl } from "./workletUrl";

export interface PendingStart {
	when?: number;
	offset?: number;
	duration?: number;
}

/** Default pre-buffer: 1 second at 48 kHz. */
const DEFAULT_PRE_BUFFER_SAMPLES = 48_000;

export interface StreamingClipNodeOptions {
	defaultFormat: StreamFormat | null;
	targetSampleRate: number;
	/** Injectable worker factory — used for testing without mocking globals. */
	createWorker?: (format: StreamFormat) => Worker | Promise<Worker>;
	/**
	 * Minimum decoded samples before playback starts.
	 * Prevents audible underruns when streaming over slow connections.
	 * Defaults to 48 000 (~1 s at 48 kHz).
	 */
	preBufferSamples?: number;
}

export interface CoordinatorStreamingOptions {
	format?: StreamFormat;
	/**
	 * Minimum decoded samples before playback starts.
	 * Prevents audible underruns when streaming over slow connections.
	 * Defaults to 48 000 (~1 s at 48 kHz).
	 */
	preBufferSamples?: number;
}

export class StreamingClipNode extends ClipNode {
	private _url: string | undefined;
	private _worker: Worker | null = null;
	private _pendingStart: PendingStart | null = null;
	private _readyToPlay = false;
	private _streamDone = false;
	private _streamOptions: StreamingClipNodeOptions;

	onerror?: (message: string) => void;
	onprogress?: (bytesReceived: number) => void;
	ondone?: () => void;

	constructor(
		public context: BaseAudioContext,
		options: ClipWorkletOptions = {},
		streamOptions: StreamingClipNodeOptions,
	) {
		super(context, options);
		this._streamOptions = streamOptions;
	}

	get url(): string | undefined {
		return this._url;
	}

	set url(value: string) {
		this._url = value;
		this._startStream(value);
	}

	private async _startStream(url: string): Promise<void> {
		// Tear down any previous worker
		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}

		this._readyToPlay = false;
		this._streamDone = false;

		const format = this._streamOptions.defaultFormat ?? detectStreamFormat(url);

		const workerFactory =
			this._streamOptions.createWorker ?? createStreamingWorker;
		const worker = await workerFactory(format);
		this._worker = worker;

		const channel = new MessageChannel();
		this.transferPort(channel.port2);

		const threshold =
			this._streamOptions.preBufferSamples ?? DEFAULT_PRE_BUFFER_SAMPLES;

		worker.onmessage = (ev: MessageEvent) => {
			const msg = ev.data as {
				type: string;
				bytesReceived?: number;
				samplesDecoded?: number;
				message?: string;
			};

			if (msg.type === "decoded") {
				this._tryStart(msg.samplesDecoded ?? 0, threshold);
			} else if (msg.type === "progress") {
				this.onprogress?.(msg.bytesReceived ?? 0);
			} else if (msg.type === "done") {
				this._streamDone = true;
				// If the entire stream is shorter than the threshold, start now
				this._tryStart(msg.samplesDecoded ?? 0, 0);
				this.ondone?.();
			} else if (msg.type === "error") {
				this.onerror?.(msg.message ?? "Unknown streaming error");
			}
		};

		worker.postMessage(
			{
				type: "init",
				port: channel.port1,
				url,
				targetSampleRate: this._streamOptions.targetSampleRate,
			},
			[channel.port1],
		);
	}

	private _tryStart(samplesDecoded: number, threshold: number): void {
		if (this._readyToPlay) return;
		if (samplesDecoded < threshold && !this._streamDone) return;
		this._readyToPlay = true;
		if (this._pendingStart !== null) {
			const { when, offset, duration } = this._pendingStart;
			this._pendingStart = null;
			super.start(when, offset, duration);
		}
	}

	start(when?: number, offset?: number, duration?: number): void {
		if (this._readyToPlay || this._url === "") {
			// Enough data buffered (or no streaming URL set) — start immediately
			super.start(when, offset, duration);
		} else {
			// Defer until enough decoded data has been buffered
			this._pendingStart = { when, offset, duration };
		}
	}

	stop(when?: number): void {
		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}
		super.stop(when);
	}
}

export class Coordinator {
	private _context: BaseAudioContext;
	private _moduleLoaded = false;
	private _nodes = new Set<ClipNode>();
	private _workerFactory?: (format: StreamFormat) => Worker | Promise<Worker>;

	private constructor(
		context: BaseAudioContext,
		workerFactory?: (format: StreamFormat) => Worker | Promise<Worker>,
	) {
		this._context = context;
		this._workerFactory = workerFactory;
	}

	static fromContext(
		context: BaseAudioContext,
		options?: {
			workerFactory?: (format: StreamFormat) => Worker | Promise<Worker>;
		},
	): Coordinator {
		return new Coordinator(context, options?.workerFactory);
	}

	async addModule(processorUrl?: string): Promise<void> {
		if (this._moduleLoaded) return;
		await this._context.audioWorklet.addModule(
			processorUrl ?? getProcessorBlobUrl(),
		);
		this._moduleLoaded = true;
	}

	ClipNode(options?: ClipWorkletOptions): ClipNode {
		const node = new ClipNode(this._context, options ?? {});
		this._nodes.add(node);
		return node;
	}

	StreamingClipNode(
		options?: ClipWorkletOptions,
		streamingOptions?: CoordinatorStreamingOptions,
	): StreamingClipNode {
		const node = new StreamingClipNode(this._context, options ?? {}, {
			defaultFormat: streamingOptions?.format ?? null,
			targetSampleRate: this._context.sampleRate,
			createWorker: this._workerFactory,
			preBufferSamples: streamingOptions?.preBufferSamples,
		});
		this._nodes.add(node);
		return node;
	}

	dispose(): void {
		for (const node of this._nodes) {
			node.stop();
		}
		this._nodes.clear();
	}
}
