import { useCallback } from "react";
import type { ControlKey } from "./audio/controlDefs";
import { controlDefs, loopControlDefs, paramDefs } from "./audio/controlDefs";
import { ControlSection } from "./components/ControlSection";
import { DisplayPanel } from "./components/DisplayPanel";
import { TransportButtons } from "./components/TransportButtons";
import { useClipControls } from "./hooks/useClipControls";
import { useClipNode } from "./hooks/useClipNode";

export function App() {
	const controls = useClipControls();
	const node = useClipNode({
		values: controls.values,
		enabled: controls.enabled,
		loop: controls.loop,
		setValue: controls.setValue,
	});

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

	return (
		<main>
			<hr />
			<DisplayPanel
				nodeState={node.nodeState}
				statusMessage={node.statusMessage}
				currentTime={node.infoCurrentTime}
				currentFrame={node.infoCurrentFrame}
				timesLooped={node.infoTimesLooped}
				latency={node.infoLatency}
				timeTaken={node.infoTimeTaken}
			/>
			<hr />
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
			<hr />
			<section id="controls">
				<ControlSection
					legend="Transport"
					defs={controlDefs}
					values={controls.values}
					snaps={controls.snaps}
					enabled={controls.enabled}
					onValueChange={handleValueChange}
					onToggle={handleToggle}
					onSnapChange={controls.setSnap}
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
							legend="Loop Controls"
							defs={loopControlDefs}
							values={controls.values}
							snaps={controls.snaps}
							enabled={controls.enabled}
							onValueChange={handleValueChange}
							onToggle={handleToggle}
							onSnapChange={controls.setSnap}
						/>
					)}
				</fieldset>
				<ControlSection
					legend="Parameters"
					defs={paramDefs}
					values={controls.values}
					snaps={controls.snaps}
					enabled={controls.enabled}
					onValueChange={handleValueChange}
					onToggle={handleToggle}
					onSnapChange={controls.setSnap}
				/>
			</section>
			<hr />
		</main>
	);
}
