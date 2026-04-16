import { useCallback, useEffect, useRef, useState } from "react";
import { ClipNode } from "../audio/clip/node";
import type { ClipNodeState, FrameData, LoopMode } from "../audio/clip/types";
import { getProcessorBlobUrl } from "../audio/clip/url";
import { float32ArrayFromAudioBuffer, linFromDb } from "../audio/utils";
import type { ControlKey } from "../controls/controlDefs";
import { SAMPLE_RATE } from "../controls/controlDefs";
import { loadFromCache } from "../data/cache";
import { loadUploadedFile, saveUploadedFile } from "../data/fileStore";
import {
	applyToggleToClip as applyToggle,
	applyValueToClip as applyValue,
} from "./clipHelpers";

interface UseClipNodeParams {
	values: Record<ControlKey, number>;
	enabled: Record<ControlKey, boolean>;
	loop: boolean;
	loopMode: LoopMode;
	setValue: (key: ControlKey, val: number) => void;
	/** URL to a default sound file to load when no previously uploaded file exists in IndexedDB. */
	defaultSoundUrl?: string;
}

export interface UseClipNodeReturn {
	nodeState: ClipNodeState;
	statusMessage: string | null;
	soundName: string | null;
	audioDuration: number | null;
	infoCurrentTime: string;
	infoCurrentFrame: string;
	infoTimesLooped: string;
	infoLatency: string;
	infoTimeTaken: string;
	start: () => Promise<void>;
	stop: () => void;
	pause: () => void;
	resume: () => void;
	dispose: () => void;
	logState: () => void;
	loadSound: () => void;
	applyValue: (key: ControlKey, val: number) => void;
	applyValues: (valuesToApply: Partial<Record<ControlKey, number>>) => void;
	applyToggle: (key: ControlKey, on: boolean) => void;
	setLoopOnNode: (checked: boolean) => void;
	setLoopModeOnNode: (mode: LoopMode) => void;
}

export function useClipNode({
	values,
	enabled,
	loop,
	loopMode,
	setValue,
	defaultSoundUrl,
}: UseClipNodeParams): UseClipNodeReturn {
	const [nodeState, setNodeState] = useState<ClipNodeState>("initial");
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [soundName, setSoundName] = useState<string | null>(null);
	const [audioDuration, setAudioDuration] = useState<number | null>(null);
	const [infoCurrentTime, setInfoCurrentTime] = useState("0");
	const [infoCurrentFrame, setInfoCurrentFrame] = useState("0");
	const [infoTimesLooped, setInfoTimesLooped] = useState("0");
	const [infoLatency, setInfoLatency] = useState("unknown");
	const [infoTimeTaken, setInfoTimeTaken] = useState("unknown");

	const ctxRef = useRef<AudioContext | null>(null);
	const nodeRef = useRef<ClipNode | null>(null);
	const bufferRef = useRef<AudioBuffer | null>(null);
	const frameRef = useRef<FrameData | null>(null);

	// RAF loop for display info
	useEffect(() => {
		let id: number;
		const tick = () => {
			const f = frameRef.current;
			if (f) {
				const [ct, cf, ph, tt] = f;
				setInfoCurrentTime(ct.toPrecision(4));
				setInfoCurrentFrame(cf.toString());
				setInfoTimeTaken(tt.toFixed(4));
				setValue("playhead", ph);
			}
			id = requestAnimationFrame(tick);
		};
		id = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(id);
	}, [setValue]);

	const ensureContext = useCallback(async () => {
		if (ctxRef.current) return ctxRef.current;
		const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
		await ctx.audioWorklet.addModule(getProcessorBlobUrl());
		ctxRef.current = ctx;
		return ctx;
	}, []);

	const decodeAudio = useCallback(
		async (source: string | ArrayBuffer) => {
			const ctx = await ensureContext();
			let arrayBuffer: ArrayBuffer | undefined;
			if (typeof source === "string") {
				arrayBuffer = await loadFromCache(source);
			} else {
				arrayBuffer = source;
			}
			if (!arrayBuffer) throw new Error("Could not load audio data");
			const decoded = await ctx.decodeAudioData(arrayBuffer);
			bufferRef.current = decoded;
			setAudioDuration(decoded.duration);
			return decoded;
		},
		[ensureContext],
	);

	const createNode = useCallback(
		(ctx: AudioContext, buffer: AudioBuffer): ClipNode => {
			const node = new ClipNode(ctx, {
				processorOptions: {
					buffer: float32ArrayFromAudioBuffer(buffer),
					loopStart: values.loopStart,
					loopEnd: values.loopEnd,
					duration: values.duration,
					offset: values.offset,
					fadeInDuration: values.fadeIn,
					fadeOutDuration: values.fadeOut,
					loop,
					loopMode,
					enableDetune: enabled.detune,
					enableFadeIn: enabled.fadeIn,
					enableFadeOut: enabled.fadeOut,
					enableGain: enabled.gain,
					enableHighpass: enabled.highpass,
					enableLowpass: enabled.lowpass,
					enablePan: enabled.pan,
					enablePlaybackRate: enabled.playbackRate,
					enableLoopStart: enabled.loopStart,
					enableLoopEnd: enabled.loopEnd,
					enableLoopCrossfade: enabled.loopCrossfade,
				},
			});

			node.connect(ctx.destination);

			node.onstatechange = (e) => setNodeState(e.state);
			node.onlooped = () => setInfoTimesLooped(node.timesLooped.toString());
			node.onframe = (e) => {
				frameRef.current = e.data;
			};

			node.addEventListener("processorerror", (e) =>
				console.error("processor error", e),
			);

			node.loop = loop;
			node.loopMode = loopMode;
			node.playbackRate.value = values.playbackRate;
			node.detune.value = values.detune;
			node.lowpass.value = values.lowpass;
			node.highpass.value = values.highpass;
			node.gain.value = linFromDb(values.gain);
			node.pan.value = values.pan;

			setInfoLatency(
				ctx.outputLatency != null
					? `base: ${Math.round(ctx.baseLatency * ctx.sampleRate)} | output: ${Math.round(ctx.outputLatency * ctx.sampleRate)}`
					: "unknown",
			);

			return node;
		},
		[loop, values, enabled, loopMode],
	);

	const start = useCallback(async () => {
		const ctx = await ensureContext();
		const buffer = bufferRef.current;
		if (!buffer) {
			setStatusMessage("Load a sound file first.");
			return;
		}
		setStatusMessage(null);

		if (!nodeRef.current) {
			nodeRef.current = createNode(ctx, buffer);
		}

		ctx.resume();
		const node = nodeRef.current;
		const delay = enabled.startDelay ? values.startDelay : 0;
		const offset = enabled.offset ? values.offset : 0;
		const duration = enabled.duration ? values.duration : -1;
		node.start(ctx.currentTime + delay, offset, duration);
	}, [
		ensureContext,
		createNode,
		values.startDelay,
		values.offset,
		values.duration,
		enabled.startDelay,
		enabled.offset,
		enabled.duration,
	]);

	const stop = useCallback(() => {
		const ctx = ctxRef.current;
		const node = nodeRef.current;
		if (!ctx || !node) return;
		const delay = enabled.stopDelay ? values.stopDelay : 0;
		node.stop(ctx.currentTime + delay);
	}, [values.stopDelay, enabled.stopDelay]);

	const pause = useCallback(() => {
		const ctx = ctxRef.current;
		const node = nodeRef.current;
		if (!ctx || !node) return;
		const delay = enabled.stopDelay ? values.stopDelay : 0;
		node.pause(ctx.currentTime + delay);
	}, [values.stopDelay, enabled.stopDelay]);

	const resume = useCallback(() => {
		const ctx = ctxRef.current;
		const node = nodeRef.current;
		if (!ctx || !node) return;
		const delay = enabled.startDelay ? values.startDelay : 0;
		node.resume(ctx.currentTime + delay);
	}, [values.startDelay, enabled.startDelay]);

	const dispose = useCallback(() => {
		nodeRef.current?.dispose();
		nodeRef.current = null;
		setNodeState("disposed");
	}, []);

	const logState = useCallback(() => {
		nodeRef.current?.logState();
	}, []);

	const loadFromArrayBuffer = useCallback(
		async (ab: ArrayBuffer, name: string) => {
			const buf = await decodeAudio(ab);
			bufferRef.current = buf;
			setSoundName(name);
			setValue("playhead", 0);
		},
		[decodeAudio, setValue],
	);

	// Auto-load last uploaded file from IndexedDB on mount, falling back to defaultSoundUrl
	useEffect(() => {
		loadUploadedFile()
			.then(async (stored) => {
				if (stored) {
					await loadFromArrayBuffer(stored.arrayBuffer, stored.name);
					return;
				}
				if (defaultSoundUrl) {
					const res = await fetch(defaultSoundUrl);
					if (!res.ok)
						throw new Error(
							`Failed to fetch ${defaultSoundUrl}: ${res.status}`,
						);
					const ab = await res.arrayBuffer();
					const name = defaultSoundUrl.split("/").pop() ?? "default";
					await loadFromArrayBuffer(ab, name);
				}
			})
			.catch((err) =>
				console.error("[useClipNode] Failed to auto-load sound:", err),
			);
	}, [loadFromArrayBuffer, defaultSoundUrl]);

	const loadSound = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "audio/*";
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const ab = await file.arrayBuffer();
			const copy = ab.slice(0);
			await loadFromArrayBuffer(ab, file.name);
			saveUploadedFile(file.name, copy).catch((err) =>
				console.error("[fileStore] Failed to save to IndexedDB:", err),
			);
		};
		input.click();
	}, [loadFromArrayBuffer]);

	const applyValueToNode = useCallback(
		(key: ControlKey, val: number) => {
			setValue(key, val);
			const node = nodeRef.current;
			if (node) applyValue(node, key, val);
		},
		[setValue],
	);

	const applyToggleToNode = useCallback((key: ControlKey, on: boolean) => {
		const node = nodeRef.current;
		if (node) applyToggle(node, key, on);
	}, []);

	const applyValuesToNode = useCallback(
		(valuesToApply: Partial<Record<ControlKey, number>>) => {
			const node = nodeRef.current;
			if (!node) return;

			for (const [key, value] of Object.entries(valuesToApply) as Array<
				[ControlKey, number]
			>) {
				applyValue(node, key, value);
			}
		},
		[],
	);

	const setLoopOnNode = useCallback((checked: boolean) => {
		const node = nodeRef.current;
		if (node) node.loop = checked;
	}, []);

	const setLoopModeOnNode = useCallback((mode: LoopMode) => {
		const node = nodeRef.current;
		if (node) node.loopMode = mode;
	}, []);

	return {
		nodeState,
		statusMessage,
		soundName,
		audioDuration,
		infoCurrentTime,
		infoCurrentFrame,
		infoTimesLooped,
		infoLatency,
		infoTimeTaken,
		start,
		stop,
		pause,
		resume,
		dispose,
		logState,
		loadSound,
		applyValue: applyValueToNode,
		applyValues: applyValuesToNode,
		applyToggle: applyToggleToNode,
		setLoopOnNode,
		setLoopModeOnNode,
	} satisfies UseClipNodeReturn;
}
