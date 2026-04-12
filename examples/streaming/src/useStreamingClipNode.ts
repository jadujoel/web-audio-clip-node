import { useCallback, useRef, useState, type RefObject } from "react";
import {
	ClipNode,
	getProcessorBlobUrl,
	linFromDb,
} from "@jadujoel/web-audio-clip-node";
import type { ControlKey } from "@jadujoel/web-audio-clip-node";
import type {
	ClipNodeState,
	FrameData,
} from "@jadujoel/web-audio-clip-node";
import { workerCode } from "../generated/worker-code";
import {
	clampSeekTargetSeconds,
	secondsFromSamples,
} from "./streamTimeline";

function getWorkerBlobUrl(): string {
	const blob = new Blob([workerCode], { type: "application/javascript" });
	return URL.createObjectURL(blob);
}

function applyValueToClip(node: ClipNode, key: ControlKey, value: number) {
	switch (key) {
		case "playhead":
			node.playhead = value;
			break;
		case "offset":
			node.offset = value;
			break;
		case "duration":
			node.duration = value;
			break;
		case "loopStart":
			node.loopStart = value;
			break;
		case "loopEnd":
			node.loopEnd = value;
			break;
		case "loopCrossfade":
			node.loopCrossfade = value;
			break;
		case "fadeIn":
			node.fadeIn = value;
			break;
		case "fadeOut":
			node.fadeOut = value;
			break;
		case "playbackRate":
			node.playbackRate.value = value;
			break;
		case "detune":
			node.detune.value = value;
			break;
		case "gain":
			node.gain.value = linFromDb(value);
			break;
		case "pan":
			node.pan.value = value;
			break;
		case "lowpass":
			node.lowpass.value = value;
			break;
		case "highpass":
			node.highpass.value = value;
			break;
		case "startDelay":
		case "stopDelay":
			break;
	}
}

function applyToggleToClip(node: ClipNode, key: ControlKey, on: boolean) {
	switch (key) {
		case "fadeIn":
			node.toggleFadeIn(on);
			break;
		case "fadeOut":
			node.toggleFadeOut(on);
			break;
		case "loopCrossfade":
			node.toggleLoopCrossfade(on);
			break;
		case "loopStart":
			node.toggleLoopStart(on);
			break;
		case "loopEnd":
			node.toggleLoopEnd(on);
			break;
		case "playbackRate":
			node.togglePlaybackRate(on);
			break;
		case "detune":
			node.toggleDetune(on);
			break;
		case "gain":
			node.toggleGain(on);
			break;
		case "pan":
			node.togglePan(on);
			break;
		case "lowpass":
			node.toggleLowpass(on);
			break;
		case "highpass":
			node.toggleHighpass(on);
			break;
		case "offset":
			node.offset = on ? node.offset : 0;
			break;
		case "duration":
			node.duration = on ? node.duration : -1;
			break;
		case "startDelay":
		case "stopDelay":
			break;
	}
}

interface UseStreamingClipNodeParams {
	values: Record<ControlKey, number>;
	enabled: Record<ControlKey, boolean>;
	loop: boolean;
	setValue: (key: ControlKey, val: number) => void;
}

export function useStreamingClipNode({
	values,
	enabled,
	loop,
	setValue,
}: UseStreamingClipNodeParams) {
	const [nodeState, setNodeState] = useState<ClipNodeState>("initial");
	const [statusMessage, setStatusMessage] = useState<string | null>("Idle");
	const [progress, setProgress] = useState(0);
	const [audioDuration, setAudioDuration] = useState<number | null>(null);
	const [seekableDuration, setSeekableDuration] = useState<number | null>(null);
	const [infoLatency, setInfoLatency] = useState("unknown");
	const statusRef = useRef<string | null>("Idle");
	const finalDurationRef = useRef<number | null>(null);
	const timelineSampleRateRef = useRef<number | null>(null);

	const ctxRef = useRef<AudioContext | null>(null);
	const clipRef = useRef<ClipNode | null>(null);
	const workerRef = useRef<Worker | null>(null);
	const frameRef = useRef<FrameData | null>(null);
	const timesLoopedRef = useRef("0");

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

	const stream = useCallback(
		async (url: string, throttle: number) => {
			if (!url.trim()) {
				setStatus("Enter a URL first.");
				return;
			}

			// Tear down previous run
			if (workerRef.current) {
				workerRef.current.postMessage({ type: "abort" });
				workerRef.current.terminate();
				workerRef.current = null;
			}
			if (clipRef.current) {
				clipRef.current.stop();
				clipRef.current.disconnect();
				clipRef.current = null;
			}

			const ctx = await ensureContext();
			await ctx.resume();
			finalDurationRef.current = null;
			timelineSampleRateRef.current = ctx.sampleRate;
			setAudioDuration(null);
			setSeekableDuration(null);

			// Create ClipNode (no buffer — streaming mode)
			const clip = new ClipNode(ctx);
			clip.loop = loop;
			clip.connect(ctx.destination);

			// Apply current control values
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
			clip.onframe = (data) => {
				frameRef.current = data;
			};

			setInfoLatency(
				ctx.outputLatency != null
					? `base: ${Math.round(ctx.baseLatency * ctx.sampleRate)} | output: ${Math.round(ctx.outputLatency * ctx.sampleRate)}`
					: "unknown",
			);

			clipRef.current = clip;

			// Create MessageChannel: port1 → Worker, port2 → Processor
			const channel = new MessageChannel();
			clip.transferPort(channel.port2);

			// Create and start decode worker
			const worker = new Worker(getWorkerBlobUrl());
			workerRef.current = worker;

			worker.onmessage = (ev: MessageEvent) => {
				const { type } = ev.data;
				switch (type) {
					case "streamMeta": {
						const sampleRate = ev.data.sampleRate as number;
						const estimatedTotalSamples =
							ev.data.estimatedTotalSamples as number | null;
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
								`Downloading… ${((bytesReceived / 1024) | 0)} / ${((totalBytes / 1024) | 0)} KB`,
							);
						} else {
							setStatus(
								`Downloading… ${((bytesReceived / 1024) | 0)} KB`,
							);
						}
						break;
					}
					case "decoded": {
						const { samplesDecoded } = ev.data;
						if (timelineSampleRateRef.current != null) {
							const nextSeekable = secondsFromSamples(
								samplesDecoded,
								timelineSampleRateRef.current,
							);
							if (nextSeekable != null) {
								setSeekableDuration(nextSeekable);
							}
						}
						if (
							samplesDecoded > 0 &&
							clipRef.current?.state === "initial"
						) {
							clipRef.current.start();
							setStatus("Streaming & playing…");
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
						setStatus(
							`Done — ${samples} samples decoded.`,
						);
						setProgress(1);
						if (ctx.sampleRate > 0) {
							const duration = samples / ctx.sampleRate;
							finalDurationRef.current = duration;
							setAudioDuration(duration);
							setSeekableDuration(duration);
						}
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
			setProgress(0);
			setNodeState("initial");
		},
		[ensureContext, loop, values, enabled, setStatus],
	);

	const pause = useCallback(() => {
		const clip = clipRef.current;
		if (!clip) return;
		if (clip.state === "resumed" || clip.state === "started") {
			clip.pause();
			setStatus("Paused.");
		} else if (clip.state === "paused") {
			clip.start();
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
		if (finalDurationRef.current != null) {
			setAudioDuration(finalDurationRef.current);
		}
	}, [setStatus]);

	const seekPlayhead = useCallback(
		(targetSeconds: number) => {
			const { value, clamped } = clampSeekTargetSeconds(
				targetSeconds,
				seekableDuration,
			);
			setValue("playhead", value);
			const node = clipRef.current;
			if (node) {
				applyValueToClip(node, "playhead", value);
			}
			if (clamped) {
				setStatus("Seek limited to decoded region while streaming.");
			}
		},
		[seekableDuration, setStatus, setValue],
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

	return {
		nodeState,
		statusMessage,
		progress,
		audioDuration,
		seekableDuration,
		frameRef: frameRef as RefObject<FrameData | null>,
		timesLoopedRef: timesLoopedRef as RefObject<string>,
		infoLatency,
		stream,
		pause,
		stop,
		seekPlayhead,
		applyValue,
		applyValues,
		applyToggle,
		setLoopOnNode,
	};
}
