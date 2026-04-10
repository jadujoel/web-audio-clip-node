import { useCallback, useEffect, useRef, useState } from "react";
import { ClipNode } from "../audio/ClipNode";
import { loadFromCache } from "../audio/cache";
import type { ControlKey } from "../audio/controlDefs";
import { SAMPLE_RATE } from "../audio/controlDefs";
import { loadUploadedFile, saveUploadedFile } from "../audio/fileStore";
import type { ClipNodeState, FrameData } from "../audio/types";
import { float32ArrayFromAudioBuffer, linFromDb } from "../audio/utils";

function applyValue(node: ClipNode, key: ControlKey, value: number) {
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

function applyToggle(node: ClipNode, key: ControlKey, on: boolean) {
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
			// These are applied at start/stop time; toggle state is handled in the hook
			break;
	}
}

interface UseClipNodeParams {
	values: Record<ControlKey, number>;
	enabled: Record<ControlKey, boolean>;
	loop: boolean;
	setValue: (key: ControlKey, val: number) => void;
}

export function useClipNode({
	values,
	enabled,
	loop,
	setValue,
}: UseClipNodeParams) {
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
		await ctx.audioWorklet.addModule("/processor.js");
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

			node.onstatechange = (s) => setNodeState(s);
			node.onlooped = () => setInfoTimesLooped(node.timesLooped.toString());
			node.onframe = (data) => {
				frameRef.current = data;
			};

			node.addEventListener("processorerror", (e) =>
				console.error("processor error", e),
			);

			node.loop = loop;
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
		[loop, values, enabled],
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

	// Auto-load last uploaded file from IndexedDB on mount
	useEffect(() => {
		loadUploadedFile()
			.then((stored) => {
				if (stored) {
					loadFromArrayBuffer(stored.arrayBuffer, stored.name).catch((err) =>
						console.error("[fileStore] Failed to restore file:", err),
					);
				}
			})
			.catch((err) =>
				console.error("[fileStore] Failed to load from IndexedDB:", err),
			);
	}, [loadFromArrayBuffer]);

	const loadSound = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "audio/*";
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const ab = await file.arrayBuffer();
			await loadFromArrayBuffer(ab, file.name);
			saveUploadedFile(file.name, ab).catch((err) =>
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

	const setLoopOnNode = useCallback((checked: boolean) => {
		const node = nodeRef.current;
		if (node) node.loop = checked;
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
		applyToggle: applyToggleToNode,
		setLoopOnNode,
	};
}
