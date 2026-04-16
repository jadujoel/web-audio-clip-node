import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ClipNode } from "../audio/ClipNode";
import type {
	ClipNodeState,
	FrameData,
	GapPlaybackStrategy,
	LoopMode,
} from "../audio/types";
import { getProcessorBlobUrl } from "../audio/workletUrl";
import type { ControlKey } from "../controls/controlDefs";
import type { StreamFormat } from "../streaming";
import {
	createStreamingWorker,
	detectStreamFormat,
	getStreamingWorkerUrl,
} from "../streaming";
import { clampSeekTargetSamples, secondsFromSamples } from "../streamTimeline";
import type { AudioDecoderPolyfillOptions } from "../workers/audioDecoderPolyfill";
import { applyToggleToClip, applyValueToClip } from "./clipHelpers";

interface UseStreamingClipNodeParams {
	values: Record<ControlKey, number>;
	enabled: Record<ControlKey, boolean>;
	loop: boolean;
	loopMode: LoopMode;
	setValue: (key: ControlKey, val: number) => void;
	polyfillOptions?: AudioDecoderPolyfillOptions;
}

export function useStreamingClipNode({
	values,
	enabled,
	loop,
	loopMode,
	setValue,
	polyfillOptions,
}: UseStreamingClipNodeParams) {
	const [nodeState, setNodeState] = useState<ClipNodeState>("initial");
	const [statusMessage, setStatusMessage] = useState<string | null>("Idle");
	const [progress, setProgress] = useState(0);
	const [audioDuration, setAudioDuration] = useState<number | null>(null);
	const [seekableDuration, setSeekableDuration] = useState<number | null>(null);
	const [seekableSamples, setSeekableSamples] = useState<number | null>(null);

	const configureClip = useCallback(
		(ctx: AudioContext, clip: ClipNode) => {
			clip.loop = loop;
			clip.loopMode = loopMode;
			clip.connect(ctx.destination);

			for (const key of Object.keys(values) as ControlKey[]) {
				applyValueToClip(clip, key, values[key]);
			}
			for (const key of Object.keys(enabled) as ControlKey[]) {
				if (!enabled[key]) {
					applyToggleToClip(clip, key, false);
				}
			}

			clip.onstatechange = (s) => setNodeState(s);
			clip.onlooped = () => {
				timesLoopedRef.current = clip.timesLooped.toString();
			};
			// Capture the generation at clip creation time so stale frames
			// from a torn-down clip are ignored.
			const gen = frameGenRef.current;
			clip.onframe = (data) => {
				if (frameGenRef.current === gen) {
					frameRef.current = data;
				}
			};

			setInfoLatency(
				ctx.outputLatency != null
					? `base: ${Math.round(ctx.baseLatency * ctx.sampleRate)} | output: ${Math.round(ctx.outputLatency * ctx.sampleRate)}`
					: "unknown",
			);

			clipRef.current = clip;
		},
		[enabled, loop, loopMode, values],
	);
	const [infoLatency, setInfoLatency] = useState("unknown");
	const statusRef = useRef<string | null>("Idle");
	const finalDurationRef = useRef<number | null>(null);
	const timelineSampleRateRef = useRef<number | null>(null);

	const ctxRef = useRef<AudioContext | null>(null);
	const clipRef = useRef<ClipNode | null>(null);
	const workerRef = useRef<Worker | null>(null);
	const frameRef = useRef<FrameData | null>(null);
	const frameGenRef = useRef(0);
	const timesLoopedRef = useRef("0");
	const gapStrategyRef = useRef<GapPlaybackStrategy>("hold");
	const [playbackGeneration, setPlaybackGeneration] = useState(0);

	const ensureContext = useCallback(async () => {
		if (ctxRef.current) return ctxRef.current;
		const ctx = new AudioContext({ sampleRate: 48000 });
		await ctx.audioWorklet.addModule(getProcessorBlobUrl());
		ctxRef.current = ctx;
		return ctx;
	}, []);

	const setStatus = useCallback((next: string) => {
		if (statusRef.current === next) return;
		statusRef.current = next;
		setStatusMessage(next);
	}, []);

	useEffect(() => {
		const clip = clipRef.current;
		if (!clip) return;
		clip.loop = loop;
		clip.loopMode = loopMode;
	}, [loop, loopMode]);

	const stream = useCallback(
		async (
			url: string,
			throttle: number,
			format?: StreamFormat,
			gapStrategy?: GapPlaybackStrategy,
		) => {
			if (!url.trim()) {
				setStatus("Enter a URL first.");
				return;
			}

			// Increment generation so playhead effect resets its display value
			setPlaybackGeneration((g) => g + 1);

			// Tear down previous run
			frameGenRef.current++;
			if (workerRef.current) {
				workerRef.current.postMessage({ type: "abort" });
				workerRef.current.terminate();
				workerRef.current = null;
			}
			if (clipRef.current) {
				clipRef.current.onstatechange = undefined;
				clipRef.current.onframe = undefined;
				clipRef.current.stop();
				clipRef.current.disconnect();
				clipRef.current = null;
			}
			frameRef.current = null;

			try {
				const ctx = await ensureContext();
				await ctx.resume();
				const selectedFormat = format ?? detectStreamFormat(url);
				finalDurationRef.current = null;
				timelineSampleRateRef.current = ctx.sampleRate;
				setAudioDuration(null);
				setSeekableDuration(null);
				setSeekableSamples(null);
				setProgress(0);

				// Create ClipNode (no buffer — streaming mode)
				const clip = new ClipNode(ctx);
				clipRef.current = clip;
				configureClip(ctx, clip);

				// Apply gap playback strategy
				if (gapStrategy) {
					gapStrategyRef.current = gapStrategy;
					clip.port.postMessage({
						type: "streamGapStrategy",
						data: gapStrategy,
					});
				}

				// Create MessageChannel: port1 → Worker, port2 → Processor
				const channel = new MessageChannel();
				clip.transferPort(channel.port2);

				// Create and start decode worker
				const worker = polyfillOptions?.enabled
					? await createStreamingWorker(selectedFormat, polyfillOptions)
					: new Worker(getStreamingWorkerUrl(selectedFormat));
				workerRef.current = worker;
				worker.onerror = (event: ErrorEvent) => {
					setStatus(
						`Error: worker startup failed${event.message ? ` (${event.message})` : ""}`,
					);
				};
				worker.onmessageerror = () => {
					setStatus("Error: worker message channel failed.");
				};

				worker.onmessage = (ev: MessageEvent) => {
					const { type } = ev.data;
					switch (type) {
						case "streamMeta": {
							const sampleRate = ev.data.sampleRate as number;
							const estimatedTotalSamples = ev.data.estimatedTotalSamples as
								| number
								| null;
							timelineSampleRateRef.current =
								sampleRate > 0 ? sampleRate : timelineSampleRateRef.current;
							if (
								estimatedTotalSamples != null &&
								timelineSampleRateRef.current != null
							) {
								const estimatedDuration = secondsFromSamples(
									estimatedTotalSamples,
									timelineSampleRateRef.current,
								);
								if (
									estimatedDuration != null &&
									finalDurationRef.current == null
								) {
									setAudioDuration(estimatedDuration);
								}
							}
							break;
						}
						case "progress": {
							const { bytesReceived, totalBytes } = ev.data;
							if (totalBytes) {
								setProgress(bytesReceived / totalBytes);
								setStatus(
									`Downloading… ${(bytesReceived / 1024) | 0} / ${(totalBytes / 1024) | 0} KB`,
								);
							} else {
								setStatus(`Downloading… ${(bytesReceived / 1024) | 0} KB`);
							}
							break;
						}
						case "decoded": {
							const { samplesDecoded } = ev.data;
							setSeekableSamples(samplesDecoded);
							if (timelineSampleRateRef.current != null) {
								const nextSeekable = secondsFromSamples(
									samplesDecoded,
									timelineSampleRateRef.current,
								);
								if (nextSeekable != null) {
									setSeekableDuration(nextSeekable);
								}
							}
							if (samplesDecoded >= ctx.sampleRate) {
								setStatus("Ready to play.");
							}
							break;
						}
						case "info": {
							setStatus(
								`Decoding: ${ev.data.sampleRate} Hz, ${ev.data.channels} ch`,
							);
							break;
						}
						case "done": {
							const samples = ev.data.samplesDecoded as number;
							setProgress(1);
							if (ctx.sampleRate > 0) {
								const duration = samples / ctx.sampleRate;
								finalDurationRef.current = duration;
								setAudioDuration(duration);
								setSeekableDuration(duration);
								setSeekableSamples(samples);
							}
							setStatus(
								clipRef.current?.state === "initial"
									? `Done — ${samples} samples. Ready to play.`
									: `Done — ${samples} samples decoded.`,
							);
							break;
						}
						case "error": {
							setStatus(`Error: ${ev.data.message}`);
							break;
						}
						case "aborted": {
							setStatus("Aborted.");
							break;
						}
					}
				};

				const absoluteUrl = new URL(url, location.href).href;
				worker.postMessage(
					{
						type: "init",
						port: channel.port1,
						url: absoluteUrl,
						throttle,
						targetSampleRate: ctx.sampleRate,
					},
					[channel.port1],
				);

				setStatus(
					throttle > 0
						? `Starting stream… (${(throttle / 1024).toFixed(0)} KB/s)`
						: "Starting stream…",
				);
				setNodeState("initial");
			} catch (error) {
				const w = workerRef.current;
				if (w) {
					w.terminate();
					workerRef.current = null;
				}
				const c = clipRef.current;
				if (c) {
					c.disconnect();
					clipRef.current = null;
				}
				setStatus(
					`Error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[configureClip, ensureContext, polyfillOptions, setStatus],
	);

	const play = useCallback(() => {
		const clip = clipRef.current;
		if (!clip) return;
		if (clip.state === "initial") {
			setPlaybackGeneration((g) => g + 1);
			frameRef.current = null;
			clip.start();
			setStatus("Playing…");
		}
	}, [setStatus]);

	const pause = useCallback(() => {
		const clip = clipRef.current;
		if (!clip) return;
		if (clip.state === "resumed" || clip.state === "started") {
			clip.pause();
			setStatus("Paused.");
		} else if (clip.state === "paused") {
			clip.resume();
			setStatus("Resumed.");
		}
	}, [setStatus]);

	const stop = useCallback(() => {
		const clip = clipRef.current;
		if (!clip) return;
		clip.stop();
		if (workerRef.current) {
			workerRef.current.postMessage({ type: "abort" });
			workerRef.current.terminate();
			workerRef.current = null;
		}
		setProgress(0);
		setStatus("Stopped.");
		setSeekableDuration(null);
		setSeekableSamples(null);
		if (finalDurationRef.current != null) {
			setAudioDuration(finalDurationRef.current);
		}
	}, [setStatus]);

	const seekPlayhead = useCallback(
		(targetSample: number) => {
			let seekValue: number;
			if (gapStrategyRef.current === "silence") {
				seekValue = Number.isFinite(targetSample)
					? Math.max(0, Math.floor(targetSample))
					: 0;
			} else {
				const { value: clampedValue, clamped } = clampSeekTargetSamples(
					targetSample,
					seekableSamples,
				);
				seekValue = clampedValue;
				if (clamped) {
					setStatus("Seek limited to decoded region while streaming.");
				}
			}
			setValue("playhead", seekValue);
			const node = clipRef.current;
			if (node) {
				applyValueToClip(node, "playhead", seekValue);
			}
		},
		[seekableSamples, setStatus, setValue],
	);

	const applyValue = useCallback(
		(key: ControlKey, val: number) => {
			setValue(key, val);
			const node = clipRef.current;
			if (node) applyValueToClip(node, key, val);
		},
		[setValue],
	);

	const applyToggle = useCallback((key: ControlKey, on: boolean) => {
		const node = clipRef.current;
		if (node) applyToggleToClip(node, key, on);
	}, []);

	const applyValues = useCallback(
		(valuesToApply: Partial<Record<ControlKey, number>>) => {
			const node = clipRef.current;
			if (!node) return;
			for (const [key, value] of Object.entries(valuesToApply) as Array<
				[ControlKey, number]
			>) {
				applyValueToClip(node, key, value);
			}
		},
		[],
	);

	const setLoopOnNode = useCallback((checked: boolean) => {
		const node = clipRef.current;
		if (node) node.loop = checked;
	}, []);

	const setLoopModeOnNode = useCallback((mode: LoopMode) => {
		const clip = clipRef.current;
		if (clip) clip.loopMode = mode;
	}, []);

	const setGapPlaybackStrategyOnNode = useCallback(
		(strategy: GapPlaybackStrategy) => {
			gapStrategyRef.current = strategy;
			const clip = clipRef.current;
			if (clip) {
				clip.port.postMessage({ type: "streamGapStrategy", data: strategy });
			}
		},
		[],
	);

	return {
		nodeState,
		statusMessage,
		progress,
		audioDuration,
		seekableDuration,
		seekableSamples,
		frameRef: frameRef as RefObject<FrameData | null>,
		timesLoopedRef: timesLoopedRef as RefObject<string>,
		infoLatency,
		playbackGeneration,
		stream,
		play,
		pause,
		stop,
		seekPlayhead,
		applyValue,
		applyValues,
		applyToggle,
		setLoopOnNode,
		setLoopModeOnNode,
		setGapPlaybackStrategyOnNode,
	};
}
