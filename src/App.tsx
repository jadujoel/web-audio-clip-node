import { useCallback, useEffect } from "react";
import { isTempoRelativeSnap, remapTempoRelativeValue } from "./audio/utils";
import { ControlSection } from "./components/ControlSection";
import { DetuneControl } from "./components/DetuneControl";
import { DisplayPanel } from "./components/DisplayPanel";
import { FilterControl } from "./components/FilterControl";
import { GainControl } from "./components/GainControl";
import { PanControl } from "./components/PanControl";
import { PlaybackRateControl } from "./components/PlaybackRateControl";
import { PlayheadSlider } from "./components/PlayheadSlider";
import { TransportButtons } from "./components/TransportButtons";
import type { ControlKey } from "./controls/controlDefs";
import { controlDefs, loopControlDefs } from "./controls/controlDefs";
import { useClipNode } from "./hooks/useClipNode";
import { useClipControls } from "./store/clipStore";

export function App() {
	const controls = useClipControls();
	const node = useClipNode({
		values: controls.values,
		enabled: controls.enabled,
		loop: controls.loop,
		setValue: controls.setValue,
	});

	// Persist audioDuration into maxs state for locked controls (for localStorage persistence)
	useEffect(() => {
		if (node.audioDuration == null) return;
		for (const key of Object.keys(controls.maxLocked) as ControlKey[]) {
			if (controls.maxLocked[key]) {
				controls.setMax(key, node.audioDuration);
			}
		}
	}, [node.audioDuration, controls.maxLocked, controls.setMax]);

	const handleValueChange = useCallback(
		(key: ControlKey, val: number) => {
			node.applyValue(key, val);
		},
		[node.applyValue],
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

	const handleToggle = useCallback(
		(key: ControlKey, on: boolean) => {
			controls.setEnabled(key, on);
			node.applyToggle(key, on);
		},
		[controls.setEnabled, node.applyToggle],
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
			controls.setMaxLocked(key, locked);
			if (locked && node.audioDuration != null) {
				controls.setMax(key, node.audioDuration);
			}
		},
		[controls.setMaxLocked, controls.setMax, node.audioDuration],
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

	return (
		<main>
			<DisplayPanel
				nodeState={node.nodeState}
				statusMessage={node.statusMessage}
				soundName={node.soundName}
				currentTime={node.infoCurrentTime}
				currentFrame={node.infoCurrentFrame}
				timesLooped={node.infoTimesLooped}
				latency={node.infoLatency}
				timeTaken={node.infoTimeTaken}
			/>
			<TransportButtons
				nodeState={node.nodeState}
				onStart={node.start}
				onStop={node.stop}
				onPause={node.pause}
				onResume={node.resume}
				onDispose={node.dispose}
				onLog={node.logState}
				onLoadSound={node.loadSound}
			/>
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
					value={controls.tempo}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (Number.isFinite(v) && v > 0) handleTempoChange(v);
					}}
					style={{ width: 70 }}
				/>
			</fieldset>
			<PlayheadSlider
				value={controls.values.playhead}
				audioDuration={node.audioDuration}
				disabled={node.nodeState === "initial" || node.nodeState === "disposed"}
				onChange={handlePlayheadChange}
			/>
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
					tempo={controls.tempo}
					audioDuration={node.audioDuration}
					onValueChange={handleValueChange}
					onToggle={handleToggle}
					onSnapChange={controls.setSnap}
					onMinChange={controls.setMin}
					onMaxChange={controls.setMax}
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
							tempo={controls.tempo}
							audioDuration={node.audioDuration}
							onValueChange={handleValueChange}
							onToggle={handleToggle}
							onSnapChange={controls.setSnap}
							onMinChange={controls.setMin}
							onMaxChange={controls.setMax}
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
