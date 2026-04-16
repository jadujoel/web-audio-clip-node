import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoopMode } from "./audio/types";
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
import {
	getActiveLinkedControls,
	getLinkedControlPairForControl,
	getLinkedControlUpdates,
	loopLinkedControlPairs,
	transportLinkedControlPairs,
} from "./controls/linkedControlPairs";
import { useClipNode } from "./hooks/useClipNode";
import { useClipControls } from "./store/clipStore";

interface AppProps {
	useClipNodeImpl?: typeof useClipNode;
}

function buildControlUpdates<T>(
	keys: readonly ControlKey[],
	value: T,
): Partial<Record<ControlKey, T>> {
	return Object.fromEntries(
		keys.map((key) => [key, value] satisfies [ControlKey, T]),
	) as Partial<Record<ControlKey, T>>;
}

export function App({
	useClipNodeImpl = useClipNode,
}: AppProps = {}): React.JSX.Element {
	const controls = useClipControls();
	const node = useClipNodeImpl({
		values: controls.values,
		enabled: controls.enabled,
		loop: controls.loop,
		loopMode: controls.loopMode,
		setValue: controls.setValue,
	});
	const [tempoDraft, setTempoDraft] = useState(() => String(controls.tempo));
	const [isEditingTempo, setIsEditingTempo] = useState(false);

	// Persist audioDuration into maxs state for locked controls (for localStorage persistence)
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

	const handleLoopModeChange = useCallback(
		(mode: LoopMode) => {
			controls.setLoopMode(mode);
			node.setLoopModeOnNode(mode);
		},
		[controls.setLoopMode, node.setLoopModeOnNode],
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
	const loopDisabledKeys = useMemo(
		() =>
			controls.loopMode === "boomerang"
				? new Set<ControlKey>(["loopCrossfade", "loopCrossfadeOffset"])
				: undefined,
		[controls.loopMode],
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
						{controls.loop && (
							<select
								id="loopMode"
								className="loop-mode-select"
								value={controls.loopMode}
								onChange={(e) =>
									handleLoopModeChange(e.target.value as LoopMode)
								}
							>
								<option value="forward">Forward</option>
								<option value="boomerang">Boomerang</option>
							</select>
						)}
					</div>
					{controls.loop && (
						<ControlSection
							legend="Controls"
							defs={loopControlDefs}
							disabledKeys={loopDisabledKeys}
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
