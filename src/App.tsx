import { useCallback, useEffect } from "react";
import type { ControlKey } from "./audio/controlDefs";
import { controlDefs, loopControlDefs, paramDefs } from "./audio/controlDefs";
import { ControlSection } from "./components/ControlSection";
import { DisplayPanel } from "./components/DisplayPanel";
import { PlayheadSlider } from "./components/PlayheadSlider";
import { TransportButtons } from "./components/TransportButtons";
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
						if (Number.isFinite(v) && v > 0) controls.setTempo(v);
					}}
					style={{ width: 70 }}
				/>
			</fieldset>
			<PlayheadSlider
				value={controls.values.playhead}
				audioDuration={node.audioDuration}
				disabled={node.nodeState === "initial" || node.nodeState === "disposed"}
				onChange={(v) => handleValueChange("playhead", v)}
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
				<ControlSection
					legend="Parameters"
					defs={paramDefs}
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
			</section>
		</main>
	);
}
