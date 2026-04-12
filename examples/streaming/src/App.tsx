import { useCallback, useEffect, useRef, useState } from "react";
import {
	ControlSection,
	DetuneControl,
	DisplayPanel,
	FilterControl,
	GainControl,
	PanControl,
	PlaybackRateControl,
	PlayheadSlider,
	useClipControls,
} from "@jadujoel/web-audio-clip-node/react";
import type { ControlKey } from "@jadujoel/web-audio-clip-node";
import {
	controlDefs,
	loopControlDefs,
	transportLinkedControlPairs,
	loopLinkedControlPairs,
	getActiveLinkedControls,
	getLinkedControlPairForControl,
	getLinkedControlUpdates,
	isTempoRelativeSnap,
	remapTempoRelativeValue,
} from "@jadujoel/web-audio-clip-node";
import { useStreamingClipNode } from "./useStreamingClipNode";

function buildControlUpdates<T>(
	keys: readonly ControlKey[],
	value: T,
): Partial<Record<ControlKey, T>> {
	return Object.fromEntries(
		keys.map((key) => [key, value] satisfies [ControlKey, T]),
	) as Partial<Record<ControlKey, T>>;
}

export function App() {
	const controls = useClipControls();
	const node = useStreamingClipNode({
		values: controls.values,
		enabled: controls.enabled,
		loop: controls.loop,
		setValue: controls.setValue,
	});

	const [url, setUrl] = useState(
		"https://jadujoel.github.io/web-audio-clip-node/example.mp3",
	);
	const [throttle, setThrottle] = useState(0);
	const [tempoDraft, setTempoDraft] = useState(() => String(controls.tempo));
	const [isEditingTempo, setIsEditingTempo] = useState(false);
	const progressRef = useRef<HTMLDivElement>(null);

	// Sync progress bar width
	useEffect(() => {
		if (progressRef.current) {
			progressRef.current.style.width = `${Math.min(100, node.progress * 100).toFixed(1)}%`;
		}
	}, [node.progress]);

	// Persist audioDuration into maxs state for locked controls
	useEffect(() => {
		if (node.audioDuration == null) return;
		for (const key of Object.keys(controls.maxLocked) as ControlKey[]) {
			if (controls.maxLocked[key]) {
				controls.setMax(key, node.audioDuration);
			}
		}
	}, [node.audioDuration, controls.maxLocked, controls.setMax]);

	useEffect(() => {
		if (isEditingTempo) return;
		setTempoDraft(String(controls.tempo));
	}, [controls.tempo, isEditingTempo]);

	// ── Control handlers (same pattern as main App.tsx) ──

	const handleValueChange = useCallback(
		(key: ControlKey, val: number) => {
			const linkedPair = getLinkedControlPairForControl(key);
			if (linkedPair && controls.linkedPairs[linkedPair.key]) {
				const effectiveMaxs = { ...controls.maxs };
				for (const linkedKey of linkedPair.controls) {
					if (controls.maxLocked[linkedKey] && node.audioDuration != null) {
						effectiveMaxs[linkedKey] = node.audioDuration;
					}
				}
				const nextValues = getLinkedControlUpdates({
					pair: linkedPair,
					changedKey: key,
					nextValue: val,
					values: controls.values,
					mins: controls.mins,
					maxs: effectiveMaxs,
				});
				controls.setValuesPartial(nextValues);
				node.applyValues(nextValues);
				return;
			}
			node.applyValue(key, val);
		},
		[
			controls.linkedPairs,
			controls.maxLocked,
			controls.maxs,
			controls.mins,
			controls.setValuesPartial,
			controls.values,
			node.applyValue,
			node.applyValues,
			node.audioDuration,
		],
	);

	const handleTempoChange = useCallback(
		(nextTempo: number) => {
			if (!Number.isFinite(nextTempo) || nextTempo <= 0) return;
			const previousTempo = controls.tempo;
			if (nextTempo === previousTempo) return;

			const changedValues: Partial<Record<ControlKey, number>> = {};
			for (const key of Object.keys(controls.values) as ControlKey[]) {
				const snap = controls.snaps[key];
				if (!isTempoRelativeSnap(snap)) continue;
				const effectiveMax =
					controls.maxLocked[key] && node.audioDuration != null
						? node.audioDuration
						: controls.maxs[key];
				const nextValue = remapTempoRelativeValue(
					controls.values[key],
					snap,
					previousTempo,
					nextTempo,
					controls.mins[key],
					effectiveMax,
				);
				if (nextValue !== controls.values[key]) {
					changedValues[key] = nextValue;
				}
			}
			controls.setTempoAndValues(nextTempo, changedValues);
			node.applyValues(changedValues);
		},
		[
			controls.maxLocked,
			controls.maxs,
			controls.mins,
			controls.setTempoAndValues,
			controls.snaps,
			controls.tempo,
			controls.values,
			node.applyValues,
			node.audioDuration,
		],
	);

	const commitTempoDraft = useCallback(() => {
		const nextTempo = Number(tempoDraft.trim());
		setIsEditingTempo(false);
		if (!Number.isFinite(nextTempo) || nextTempo <= 0) {
			setTempoDraft(String(controls.tempo));
			return;
		}
		handleTempoChange(nextTempo);
		setTempoDraft(String(nextTempo));
	}, [controls.tempo, handleTempoChange, tempoDraft]);

	const handleSnapChange = useCallback(
		(key: ControlKey, snap: string) => {
			const linkedKeys = getActiveLinkedControls(key, controls.linkedPairs);
			controls.setSnapsPartial(buildControlUpdates(linkedKeys, snap));
		},
		[controls.linkedPairs, controls.setSnapsPartial],
	);

	const handleToggle = useCallback(
		(key: ControlKey, on: boolean) => {
			const linkedKeys = getActiveLinkedControls(key, controls.linkedPairs);
			controls.setEnabledPartial(buildControlUpdates(linkedKeys, on));
			for (const linkedKey of linkedKeys) {
				node.applyToggle(linkedKey, on);
			}
		},
		[controls.linkedPairs, controls.setEnabledPartial, node.applyToggle],
	);

	const handleMinChange = useCallback(
		(key: ControlKey, val: number) => {
			const linkedKeys = getActiveLinkedControls(key, controls.linkedPairs);
			controls.setMinsPartial(buildControlUpdates(linkedKeys, val));
		},
		[controls.linkedPairs, controls.setMinsPartial],
	);

	const handleMaxChange = useCallback(
		(key: ControlKey, val: number) => {
			const linkedKeys = getActiveLinkedControls(key, controls.linkedPairs);
			controls.setMaxsPartial(buildControlUpdates(linkedKeys, val));
		},
		[controls.linkedPairs, controls.setMaxsPartial],
	);

	const handleLoopChange = useCallback(
		(checked: boolean) => {
			controls.setLoop(checked);
			node.setLoopOnNode(checked);
		},
		[controls.setLoop, node.setLoopOnNode],
	);

	const handleMaxLockedChange = useCallback(
		(key: ControlKey, locked: boolean) => {
			const linkedKeys = getActiveLinkedControls(key, controls.linkedPairs);
			controls.setMaxLockedPartial(buildControlUpdates(linkedKeys, locked));
			if (locked && node.audioDuration != null) {
				controls.setMaxsPartial(
					buildControlUpdates(linkedKeys, node.audioDuration),
				);
			}
		},
		[
			controls.linkedPairs,
			controls.setMaxLockedPartial,
			controls.setMaxsPartial,
			node.audioDuration,
		],
	);

	const handlePlayheadChange = useCallback(
		(v: number) => handleValueChange("playhead", v),
		[handleValueChange],
	);
	const handlePlaybackRateChange = useCallback(
		(v: number) => handleValueChange("playbackRate", v),
		[handleValueChange],
	);
	const handlePlaybackRateToggle = useCallback(
		(on: boolean) => handleToggle("playbackRate", on),
		[handleToggle],
	);
	const handleDetuneChange = useCallback(
		(v: number) => handleValueChange("detune", v),
		[handleValueChange],
	);
	const handleDetuneToggle = useCallback(
		(on: boolean) => handleToggle("detune", on),
		[handleToggle],
	);
	const handleGainChange = useCallback(
		(v: number) => handleValueChange("gain", v),
		[handleValueChange],
	);
	const handleGainToggle = useCallback(
		(on: boolean) => handleToggle("gain", on),
		[handleToggle],
	);
	const handlePanChange = useCallback(
		(v: number) => handleValueChange("pan", v),
		[handleValueChange],
	);
	const handlePanToggle = useCallback(
		(on: boolean) => handleToggle("pan", on),
		[handleToggle],
	);
	const handleLowpassChange = useCallback(
		(v: number) => handleValueChange("lowpass", v),
		[handleValueChange],
	);
	const handleLowpassToggle = useCallback(
		(on: boolean) => handleToggle("lowpass", on),
		[handleToggle],
	);
	const handleHighpassChange = useCallback(
		(v: number) => handleValueChange("highpass", v),
		[handleValueChange],
	);
	const handleHighpassToggle = useCallback(
		(on: boolean) => handleToggle("highpass", on),
		[handleToggle],
	);

	const isStreaming =
		node.nodeState !== "initial" &&
		node.nodeState !== "stopped" &&
		node.nodeState !== "ended" &&
		node.nodeState !== "disposed";

	return (
		<main>
			{/* ── Streaming-specific header ── */}
			<h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
				ClipNode — Streaming
			</h1>
			<p style={{ color: "#94a3b8", marginTop: 0, fontSize: "0.9rem" }}>
				Stream &amp; decode an MP3 in a Web Worker, feeding decoded audio
				directly to the AudioWorklet processor via MessagePort.
			</p>

			<label
				htmlFor="url"
				style={{ display: "block", marginTop: "1rem", fontSize: "0.85rem", color: "#94a3b8" }}
			>
				Audio URL
			</label>
			<input
				type="text"
				id="url"
				value={url}
				onChange={(e) => setUrl(e.target.value)}
				style={{
					width: "100%",
					boxSizing: "border-box",
					padding: "0.5rem",
					marginTop: "0.25rem",
					border: "1px solid var(--color-border-subtle, #334155)",
					borderRadius: "6px",
					background: "var(--color-surface, #1e293b)",
					color: "var(--color-text, #e2e8f0)",
					fontSize: "0.9rem",
				}}
			/>

			<label
				htmlFor="throttle-select"
				style={{ display: "block", marginTop: "1rem", fontSize: "0.85rem", color: "#94a3b8" }}
			>
				Network Speed
			</label>
			<select
				id="throttle-select"
				value={throttle}
				onChange={(e) => setThrottle(Number(e.target.value))}
				style={{
					width: "100%",
					boxSizing: "border-box",
					padding: "0.5rem",
					marginTop: "0.25rem",
					border: "1px solid var(--color-border-subtle, #334155)",
					borderRadius: "6px",
					background: "var(--color-surface, #1e293b)",
					color: "var(--color-text, #e2e8f0)",
					fontSize: "0.9rem",
				}}
			>
				<option value={0}>Normal (unlimited)</option>
				<option value={204800}>Slow (~200 KB/s)</option>
				<option value={51200}>Turtle (~50 KB/s)</option>
			</select>

			<div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
				<button type="button" onClick={() => node.stream(url, throttle)}>
					▶ Stream &amp; Play
				</button>
				<button type="button" onClick={node.pause} disabled={!isStreaming}>
					⏸ Pause
				</button>
				<button type="button" onClick={node.stop} disabled={!isStreaming}>
					■ Stop
				</button>
			</div>

			<div
				style={{
					marginTop: "1rem",
					height: 6,
					borderRadius: 3,
					background: "var(--color-track, #1e293b)",
					overflow: "hidden",
				}}
			>
				<div
					ref={progressRef}
					style={{
						height: "100%",
						width: "0%",
						borderRadius: 3,
						background: "var(--color-accent, #38bdf8)",
						transition: "width 0.15s",
					}}
				/>
			</div>
			<p
				style={{
					marginTop: "0.75rem",
					fontSize: "0.85rem",
					color: "#94a3b8",
					minHeight: "1.2em",
				}}
			>
				{node.statusMessage}
			</p>

			{/* ── Display panel ── */}
			<DisplayPanel
				nodeState={node.nodeState}
				statusMessage={null}
				soundName="Stream"
				currentTime={node.infoCurrentTime}
				currentFrame={node.infoCurrentFrame}
				timesLooped={node.infoTimesLooped}
				latency={node.infoLatency}
				timeTaken={node.infoTimeTaken}
			/>

			{/* ── Tempo ── */}
			<fieldset className="control-group tempo-group">
				<legend>Tempo</legend>
				<label htmlFor="tempo" className="tempo-label">
					BPM
				</label>
				<input
					id="tempo"
					type="number"
					min={20}
					max={999}
					step={1}
					value={tempoDraft}
					onFocus={() => setIsEditingTempo(true)}
					onChange={(e) => setTempoDraft(e.target.value)}
					onBlur={commitTempoDraft}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commitTempoDraft();
							e.currentTarget.blur();
						}
						if (e.key === "Escape") {
							setIsEditingTempo(false);
							setTempoDraft(String(controls.tempo));
							e.currentTarget.blur();
						}
					}}
					style={{ width: 70 }}
				/>
			</fieldset>

			{/* ── Playhead ── */}
			<PlayheadSlider
				value={controls.values.playhead}
				audioDuration={node.audioDuration}
				disabled={
					node.nodeState === "initial" || node.nodeState === "disposed"
				}
				onChange={handlePlayheadChange}
			/>

			{/* ── Controls (reused from library) ── */}
			<section id="controls">
				<ControlSection
					legend="Transport"
					defs={controlDefs}
					values={controls.values}
					snaps={controls.snaps}
					enabled={controls.enabled}
					mins={controls.mins}
					maxs={controls.maxs}
					maxLocked={controls.maxLocked}
					linked={controls.linkedPairs}
					linkedPairs={transportLinkedControlPairs}
					tempo={controls.tempo}
					audioDuration={node.audioDuration}
					onValueChange={handleValueChange}
					onToggle={handleToggle}
					onLinkedChange={controls.setLinkedPair}
					onSnapChange={handleSnapChange}
					onMinChange={handleMinChange}
					onMaxChange={handleMaxChange}
					onMaxLockedChange={handleMaxLockedChange}
				/>
				<fieldset className="control-group">
					<legend>Loop</legend>
					<div className="loop-row">
						<label htmlFor="loop">Loop</label>
						<input
							type="checkbox"
							id="loop"
							checked={controls.loop}
							onChange={(e) => handleLoopChange(e.target.checked)}
						/>
					</div>
					{controls.loop && (
						<ControlSection
							legend="Controls"
							defs={loopControlDefs}
							values={controls.values}
							snaps={controls.snaps}
							enabled={controls.enabled}
							mins={controls.mins}
							maxs={controls.maxs}
							maxLocked={controls.maxLocked}
							linked={controls.linkedPairs}
							linkedPairs={loopLinkedControlPairs}
							tempo={controls.tempo}
							audioDuration={node.audioDuration}
							onValueChange={handleValueChange}
							onToggle={handleToggle}
							onLinkedChange={controls.setLinkedPair}
							onSnapChange={handleSnapChange}
							onMinChange={handleMinChange}
							onMaxChange={handleMaxChange}
							onMaxLockedChange={handleMaxLockedChange}
						/>
					)}
				</fieldset>
				<fieldset className="control-group">
					<legend>Parameters</legend>
					<PlaybackRateControl
						value={controls.values.playbackRate}
						defaultValue={1}
						enabled={controls.enabled.playbackRate}
						onChange={handlePlaybackRateChange}
						onToggle={handlePlaybackRateToggle}
					/>
					<DetuneControl
						value={controls.values.detune}
						defaultValue={0}
						enabled={controls.enabled.detune}
						onChange={handleDetuneChange}
						onToggle={handleDetuneToggle}
					/>
					<GainControl
						value={controls.values.gain}
						defaultValue={0}
						enabled={controls.enabled.gain}
						onChange={handleGainChange}
						onToggle={handleGainToggle}
					/>
					<PanControl
						value={controls.values.pan}
						defaultValue={0}
						enabled={controls.enabled.pan}
						onChange={handlePanChange}
						onToggle={handlePanToggle}
					/>
					<FilterControl
						label="Lowpass"
						controlKey="lowpass"
						value={controls.values.lowpass}
						defaultValue={16384}
						enabled={controls.enabled.lowpass}
						onChange={handleLowpassChange}
						onToggle={handleLowpassToggle}
					/>
					<FilterControl
						label="Highpass"
						controlKey="highpass"
						value={controls.values.highpass}
						defaultValue={32}
						enabled={controls.enabled.highpass}
						onChange={handleHighpassChange}
						onToggle={handleHighpassToggle}
					/>
				</fieldset>
			</section>
		</main>
	);
}
