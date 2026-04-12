import type { StreamFormat } from "../streaming";
import { createStreamingWorker, detectStreamFormat } from "../streaming";
import { ClipNode } from "./ClipNode";
import type { ClipWorkletOptions } from "./types";
import { getProcessorBlobUrl } from "./workletUrl";

interface PendingStart {
	when?: number;
	offset?: number;
	duration?: number;
}

interface StreamingClipNodeOptions {
	defaultFormat: StreamFormat | null;
	targetSampleRate: number;
	/** Injectable worker factory — used for testing without mocking globals. */
	createWorker?: (format: StreamFormat) => Worker;
}

export class StreamingClipNode extends ClipNode {
	private _url = "";
	private _worker: Worker | null = null;
	private _pendingStart: PendingStart | null = null;
	private _firstDecoded = false;
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

	get url(): string {
		return this._url;
	}

	set url(value: string) {
		this._url = value;
		this._startStream(value);
	}

	private _startStream(url: string): void {
		// Tear down any previous worker
		if (this._worker) {
			this._worker.postMessage({ type: "abort" });
			this._worker.terminate();
			this._worker = null;
		}

		this._firstDecoded = false;

		const format = this._streamOptions.defaultFormat ?? detectStreamFormat(url);

		const workerFactory =
			this._streamOptions.createWorker ?? createStreamingWorker;
		const worker = workerFactory(format);
		this._worker = worker;

		const channel = new MessageChannel();
		this.transferPort(channel.port2);

		worker.onmessage = (ev: MessageEvent) => {
			const msg = ev.data as {
				type: string;
				bytesReceived?: number;
				message?: string;
			};

			if (msg.type === "decoded") {
				if (!this._firstDecoded) {
					this._firstDecoded = true;
					if (this._pendingStart !== null) {
						const { when, offset, duration } = this._pendingStart;
						this._pendingStart = null;
						super.start(when, offset, duration);
					}
				}
			} else if (msg.type === "progress") {
				this.onprogress?.(msg.bytesReceived ?? 0);
			} else if (msg.type === "done") {
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

	start(when?: number, offset?: number, duration?: number): void {
		if (this._firstDecoded || this._url === "") {
			// Data ready (or no streaming URL set) — start immediately
			super.start(when, offset, duration);
		} else {
			// Defer until the first decoded chunk arrives
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
	private _defaultFormat: StreamFormat | null = null;
	private _nodes = new Set<StreamingClipNode>();
	private _workerFactory?: (format: StreamFormat) => Worker;

	private constructor(
		context: BaseAudioContext,
		workerFactory?: (format: StreamFormat) => Worker,
	) {
		this._context = context;
		this._workerFactory = workerFactory;
	}

	static fromContext(
		context: BaseAudioContext,
		options?: { workerFactory?: (format: StreamFormat) => Worker },
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

	async addStreamingSupport(format?: StreamFormat): Promise<this> {
		this._defaultFormat = format ?? null;
		return this;
	}

	ClipNode(options?: ClipWorkletOptions): StreamingClipNode {
		const node = new StreamingClipNode(this._context, options ?? {}, {
			defaultFormat: this._defaultFormat,
			targetSampleRate: this._context.sampleRate,
			createWorker: this._workerFactory,
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
