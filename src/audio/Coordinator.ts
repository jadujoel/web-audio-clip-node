import type { AudioDecoderPolyfillOptions, StreamFormat } from "../streaming";
import { createCdnWorkerFactory } from "../streaming";
import { ClipNode } from "./clip/node";
import { StreamingClipNode } from "./clip/streaming-node";
import type {
	ClipWorkletOptions,
	GapPlaybackStrategy,
	StreamPreload,
} from "./clip/types";
import { getProcessorBlobUrl } from "./clip/url";
import type { DuckNodeOptions } from "./duck/node";
import { DuckNode } from "./duck/node";
import { getDuckProcessorBlobUrl } from "./duck/url";

export type {
	PendingStart,
	StreamingClipNodeOptions,
} from "./clip/streaming-node";
export { StreamingClipNode } from "./clip/streaming-node";

export interface CoordinatorStreamingOptions {
	format?: StreamFormat;
	/** Send decoded PCM chunks as int16 to cut transfer memory roughly in half. */
	useInt16?: boolean;
	/**
	 * Minimum decoded samples before playback starts.
	 * Prevents audible underruns when streaming over slow connections.
	 * Defaults to 48 000 (~1 s at 48 kHz).
	 */
	preBufferSamples?: number;
	/**
	 * Controls when streaming data is fetched.
	 * - "none": URL is stored but fetching is deferred until start()
	 * - "metadata": Only a HEAD request detects format/size; full fetch on start()
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
	 * - "hold": Clamp playhead at committed edge (default when target length unknown).
	 * - "silence": Advance playhead through gaps, outputting silence.
	 */
	gapPlaybackStrategy?: GapPlaybackStrategy;
	/** Upfront target length in samples. Takes priority over targetDuration and decoder metadata. */
	targetNumSamples?: number;
	/** Upfront target length in seconds. Converted to samples at context sample rate. */
	targetDuration?: number;
	/** Number of samples to fade-in when transitioning from silence gap to real audio.
	 * Defaults to 128. */
	gapRecoveryFadeSamples?: number;
	/** AudioDecoder polyfill options for browsers without native WebCodecs support. */
	polyfill?: AudioDecoderPolyfillOptions;
	/** Optional network throttling bytes/sec forwarded to the decode worker. */
	throttle?: number;
}

export class Coordinator {
	private constructor(
		public context: BaseAudioContext,
		public workerFactory?: (format: StreamFormat) => Worker | Promise<Worker>,
		private moduleLoaded?: undefined | Promise<void>,
		private nodes = new Set<ClipNode>(),
		private duckNodes = new Set<DuckNode>(),
		private duckModuleLoaded?: undefined | Promise<void>,
	) {}

	/** One-line setup using embedded workers. All format workers are bundled -
	 *  no CDN fetch needed for worker scripts. */
	static fromCdn(options?: {
		sampleRate?: number;
		polyfill?: AudioDecoderPolyfillOptions;
	}): Coordinator {
		const context = new AudioContext({
			sampleRate: options?.sampleRate ?? 48000,
			latencyHint: "playback",
		});
		const coordinator = new Coordinator(
			context,
			createCdnWorkerFactory(options?.polyfill),
		);
		coordinator.addModule();
		return coordinator;
	}

	static fromContext(
		context: BaseAudioContext,
		options?: {
			workerFactory?: (format: StreamFormat) => Worker | Promise<Worker>;
			processorUrl?: string;
		},
	): Coordinator {
		const coordinator = new Coordinator(context, options?.workerFactory);
		coordinator.addModule(options?.processorUrl);
		return coordinator;
	}

	static fromWorkerFactory(
		workerFactory: (format: StreamFormat) => Worker | Promise<Worker>,
	): Coordinator {
		const context = new AudioContext({
			sampleRate: 48000,
			latencyHint: "playback",
		});
		const coordinator = new Coordinator(context, workerFactory);
		coordinator.addModule();
		return coordinator;
	}

	async addModule(processorUrl?: string): Promise<void> {
		if (this.moduleLoaded !== undefined) {
			return this.moduleLoaded;
		}
		this.moduleLoaded = this.context.audioWorklet
			.addModule(processorUrl ?? getProcessorBlobUrl())
			.catch((err) => {
				this.moduleLoaded = undefined;
				console.warn("Failed to load AudioWorklet module:", err);
			});
		return this.moduleLoaded;
	}

	createClipNode(options?: ClipWorkletOptions): ClipNode {
		const node = new ClipNode(this.context, options ?? {});
		this.nodes.add(node);
		return node;
	}

	createStreamingClipNode(
		options?: ClipWorkletOptions,
		streamingOptions?: CoordinatorStreamingOptions,
	): StreamingClipNode {
		const node = new StreamingClipNode(this.context, options ?? {}, {
			defaultFormat: streamingOptions?.format ?? null,
			targetSampleRate: this.context.sampleRate,
			createWorker: this.workerFactory,
			useInt16: streamingOptions?.useInt16,
			preBufferSamples: streamingOptions?.preBufferSamples,
			preload: streamingOptions?.preload,
			pauseFetchAheadSamples: streamingOptions?.pauseFetchAheadSamples,
			resumeFetchAheadSamples: streamingOptions?.resumeFetchAheadSamples,
			retry: streamingOptions?.retry,
			gapPlaybackStrategy: streamingOptions?.gapPlaybackStrategy,
			targetNumSamples: streamingOptions?.targetNumSamples,
			targetDuration: streamingOptions?.targetDuration,
			gapRecoveryFadeSamples: streamingOptions?.gapRecoveryFadeSamples,
			polyfill: streamingOptions?.polyfill,
			throttle: streamingOptions?.throttle,
		});
		this.nodes.add(node);
		return node;
	}

	private addDuckModule(processorUrl?: string): Promise<void> {
		if (this.duckModuleLoaded !== undefined) return this.duckModuleLoaded;
		this.duckModuleLoaded = this.context.audioWorklet
			.addModule(processorUrl ?? getDuckProcessorBlobUrl())
			.catch((err) => {
				this.duckModuleLoaded = undefined;
				console.warn("Failed to load DuckProcessor module:", err);
			});
		return this.duckModuleLoaded;
	}

	async createDuckNode(options?: DuckNodeOptions): Promise<DuckNode> {
		await this.addDuckModule();
		const node = new DuckNode(this.context, options);
		this.duckNodes.add(node);
		return node;
	}

	dispose(): void {
		for (const node of this.nodes) {
			node.dispose();
		}
		this.nodes.clear();
		for (const node of this.duckNodes) {
			node.dispose();
		}
		this.duckNodes.clear();
	}
}
