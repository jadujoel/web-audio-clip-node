import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ControlKey,
	ClipNode,
	type DuckNodeOptions,
	type LoopMode,
	controlDefs,
	getActiveLinkedControls,
	getLinkedControlPairForControl,
	getLinkedControlUpdates,
	isTempoRelativeSnap,
	loopControlDefs,
	loopLinkedControlPairs,
	remapTempoRelativeValue,
	transportLinkedControlPairs,
} from "@jadujoel/web-audio-clip-node";
import {
	ControlSection,
	DetuneControl,
	DisplayPanel,
	DuckControl,
	FilterControl,
	GainControl,
	PanControl,
	PlaybackRateControl,
	PlayheadSlider,
	TransportButtons,
	defaultDuckParams,
	type DuckParams,
	useClipControls,
	useClipNode,
	useDuckNode,
} from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";
import { guess } from "web-audio-beat-detector";

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
	const duck = useDuckNode();
	const [duckParams, setDuckParams] = useState<DuckParams>(defaultDuckParams);
	const [kickPlaying, setKickPlaying] = useState(false);
	const [kickAudible, setKickAudible] = useState(true);
	const kickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const kickGainRef = useRef<GainNode | null>(null);

	const node = useClipNode({
		values: controls.values,
		enabled: controls.enabled,
		loop: controls.loop,
		loopMode: controls.loopMode,
		setValue: controls.setValue,
		defaultSoundUrl: "../sounds/example.opus",
	});

	// Insert duck node into the audio graph when both clip output and duck node are available
	useEffect(() => {
		const output = node.outputNode;
		const ctx = node.audioContext;
		const duckNode = duck.node;
		if (!output || !ctx || !duckNode) return;

		try {
			output.disconnect();
		} catch {
			/* already disconnected */
		}
		output.connect(duckNode);
		duckNode.connect(ctx.destination);

		return () => {
			try {
				output.disconnect();
			} catch {
				/* already disconnected */
			}
			try {
				duckNode.disconnect();
			} catch {
				/* already disconnected */
			}
			output.connect(ctx.destination);
		};
	}, [node.outputNode, node.audioContext, duck.node]);

	useEffect(() => {
		const ctx = node.audioContext;
		if (!ctx) return;
		duck.ensureNode(ctx);
	}, [node.audioContext, duck.ensureNode]);

	// Sync bypass state whenever the node is created or enabled changes
	useEffect(() => {
		if (!duck.node) return;
		duck.setEnabled(duckParams.enabled);
	}, [duck.node, duckParams.enabled, duck.setEnabled]);

	const handleDuckParamChange = useCallback(
		(key: keyof DuckNodeOptions, value: number) => {
			setDuckParams((prev) => ({ ...prev, [key]: value }));
			let nodeValue = value;
			if (key === "threshold") {
				nodeValue = 10 ** (value / 20);
			} else if (key === "depth") {
				nodeValue = value / 100;
			}
			duck.setParam(key, nodeValue);
		},
		[duck.setParam],
	);

	const handleDuckToggle = useCallback(
		(enabled: boolean) => {
			setDuckParams((prev) => ({ ...prev, enabled }));
			duck.setEnabled(enabled);
		},
		[duck.setEnabled],
	);

	const playKick = useCallback(
		(ctx: AudioContext) => {
			const osc = new OscillatorNode(ctx, { type: "sine", frequency: 150 });
			const oscGain = new GainNode(ctx, { gain: 1 });
			const now = ctx.currentTime;
			osc.frequency.setValueAtTime(150, now);
			osc.frequency.exponentialRampToValueAtTime(40, now + 0.07);
			oscGain.gain.setValueAtTime(1, now);
			oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
			osc.connect(oscGain);
			if (duck.node) {
				oscGain.connect(duck.node.sidechain);
			}
			if (kickAudible && kickGainRef.current) {
				oscGain.connect(kickGainRef.current);
			}
			osc.start(now);
			osc.stop(now + 0.15);
		},
		[duck.node, kickAudible],
	);

	const startKick = useCallback(() => {
		const ctx = node.audioContext;
		if (!ctx) return;
		if (!kickGainRef.current) {
			kickGainRef.current = new GainNode(ctx, { gain: 0.6 });
			kickGainRef.current.connect(ctx.destination);
		}
		const bpm = controls.tempo || 120;
		const intervalMs = (60 / bpm) * 1000;
		playKick(ctx);
		kickIntervalRef.current = setInterval(() => playKick(ctx), intervalMs);
		setKickPlaying(true);
	}, [node.audioContext, controls.tempo, playKick]);

	const stopKick = useCallback(() => {
		if (kickIntervalRef.current) {
			clearInterval(kickIntervalRef.current);
			kickIntervalRef.current = null;
		}
		setKickPlaying(false);
	}, []);

	useEffect(() => {
		if (!kickPlaying || !node.audioContext) return;
		stopKick();
		startKick();
	}, [kickPlaying, node.audioContext, stopKick, startKick]);

	useEffect(() => {
		return () => {
			if (kickIntervalRef.current) {
				clearInterval(kickIntervalRef.current);
			}
		};
	}, []);

	const toggleKickAudible = useCallback(() => {
		setKickAudible((prev) => {
			const next = !prev;
			if (kickGainRef.current) {
				kickGainRef.current.gain.value = next ? 0.6 : 0;
			}
			return next;
		});
	}, []);

	const [tempoDraft, setTempoDraft] = useState(() => String(controls.tempo));
	const [isEditingTempo, setIsEditingTempo] = useState(false);
	const [isDetectingTempo, setIsDetectingTempo] = useState(false);

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

	const handleDetectTempo = useCallback(async () => {
		const clipNode = node.outputNode;
		if (!(clipNode instanceof ClipNode)) return;
		const audioBuffer = clipNode.buffer;
		if (!audioBuffer) return;

		setIsDetectingTempo(true);
		try {
			const result = await guess(audioBuffer);
			handleTempoChange(result.bpm);
			setTempoDraft(String(result.bpm));
		} catch {
			// detection failed — leave tempo unchanged
		} finally {
			setIsDetectingTempo(false);
		}
	}, [node.outputNode, handleTempoChange]);

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
				<button
					type="button"
					disabled={isDetectingTempo || !(node.outputNode instanceof ClipNode && node.outputNode.buffer)}
					onClick={handleDetectTempo}
				>
					{isDetectingTempo ? "Detecting…" : "Detect"}
				</button>
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
				<DuckControl
					threshold={duckParams.threshold}
					attack={duckParams.attack}
					release={duckParams.release}
					depth={duckParams.depth}
					enabled={duckParams.enabled}
					onThresholdChange={(v) => handleDuckParamChange("threshold", v)}
					onAttackChange={(v) => handleDuckParamChange("attack", v)}
					onReleaseChange={(v) => handleDuckParamChange("release", v)}
					onDepthChange={(v) => handleDuckParamChange("depth", v)}
					onToggle={handleDuckToggle}
				/>
				{duckParams.enabled && (
					<fieldset className="control-group">
						<legend>Sidechain Kick</legend>
						<div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 4px" }}>
							<button
								type="button"
								onClick={kickPlaying ? stopKick : startKick}
								disabled={!node.audioContext}
							>
								{kickPlaying ? "Stop Kick" : "Start Kick"}
							</button>
							<label className="control-row">
								<input
									type="checkbox"
									className="control-toggle"
									checked={kickAudible}
									onChange={toggleKickAudible}
								/>
								<span className="control-label">Hear Kick</span>
							</label>
						</div>
					</fieldset>
				)}
			</section>
		</main>
	);
}
