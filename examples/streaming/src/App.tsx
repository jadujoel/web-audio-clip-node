import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "./react-runtime";
import {
	ControlSection,
	DetuneControl,
	FilterControl,
	GainControl,
	PanControl,
	PlaybackRateControl,
	StreamingPlayheadTimeline,
	useClipControls,
} from "./clip-node-lib";
import type { ControlKey } from "./clip-node-lib";
import type { ClipNodeState, FrameData } from "./clip-node-lib";
import type { LoopMode } from "./clip-node-lib";
import type { GapPlaybackStrategy } from "./clip-node-lib";
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
} from "./clip-node-lib";
import { useStreamingClipNode } from "./useStreamingClipNode";
import type { RefObject } from "./react-runtime";
import type { StreamFormat } from "./clip-node-lib";
import { getDefaultUrlForFormat } from "./clip-node-lib";

/**
 * Reads frame data from a ref via its own RAF loop and updates DOM directly,
 * avoiding React re-renders on every animation frame.
 */
function StreamingDisplayPanelInner({
	nodeState,
	frameRef,
	timesLoopedRef,
	latency,
}: {
	nodeState: ClipNodeState;
	frameRef: RefObject<FrameData | null>;
	timesLoopedRef: RefObject<string>;
	latency: string;
}) {
	const timeEl = useRef<HTMLOutputElement>(null);
	const frameEl = useRef<HTMLOutputElement>(null);
	const loopsEl = useRef<HTMLOutputElement>(null);
	const ttEl = useRef<HTMLOutputElement>(null);

	useEffect(() => {
		let raf: number;
		const tick = () => {
			const f = frameRef.current;
			if (f) {
				const [ct, cf, , tt] = f;
				if (timeEl.current) timeEl.current.textContent = ct.toPrecision(4);
				if (frameEl.current)
					frameEl.current.textContent = cf.toString();
				if (ttEl.current) ttEl.current.textContent = tt.toFixed(4);
			}
			if (loopsEl.current)
				loopsEl.current.textContent = timesLoopedRef.current;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [frameRef, timesLoopedRef]);

	return (
		<section id="display">
			<code>Sound:</code>
			<output>Stream</output>
			<code>State:</code>
			<output>{nodeState}</output>
			<code>Time:</code>
			<output ref={timeEl}>0</output>
			<code>Loops:</code>
			<output ref={loopsEl}>0</output>
			<div className="display-details__row">
				<code>Frame:</code>
				<output ref={frameEl}>0</output>
				<code>Latency:</code>
				<output>{latency}</output>
				<code>TimeTaken:</code>
				<output ref={ttEl}>unknown</output>
			</div>
		</section>
	);
}
const StreamingDisplayPanel = memo(StreamingDisplayPanelInner);

/**
 * Isolates playhead updates from the parent component tree.
 * Reads the playhead position from frameRef via its own RAF loop,
 * so only this small subtree re-renders at 60fps.
 */
function StreamingPlayheadInner({
	frameRef,
	audioDuration,
	seekableSamples,
	streamProgress,
	disabled,
	onChange,
	playbackGeneration,
}: {
	frameRef: RefObject<FrameData | null>;
	audioDuration: number | null;
	seekableSamples: number | null;
	streamProgress: number;
	disabled: boolean;
	onChange: (v: number) => void;
	playbackGeneration: number;
}) {
	const [value, setValue] = useState(0);

	useEffect(() => {
		let raf: number;
		// Reset playhead display when a new stream starts
		setValue(0);
		// Track the last emitted value so we can suppress small backwards jumps
		// caused by stale frame data arriving between processor cycles.
		let last = 0;
		const tick = () => {
			const f = frameRef.current;
			if (f) {
				const next = f[2];
				// Allow forward movement always. Allow large backwards jumps
				// (seek or loop boundary). Suppress small backwards jitter
				// (threshold: 256 samples ≈ two 128-sample processing blocks).
				if (next >= last || last - next > 256) {
					last = next;
					setValue(next);
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [frameRef, playbackGeneration]);

	return (
		<StreamingPlayheadTimeline
			value={value}
			audioDuration={audioDuration}
			seekableSamples={seekableSamples}
			streamProgress={streamProgress}
			disabled={disabled}
			onChange={onChange}
		/>
	);
}
const StreamingPlayhead = memo(StreamingPlayheadInner);

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

	const [format, setFormat] = useState<StreamFormat>("OggOpus");
	const [url, setUrl] = useState(getDefaultUrlForFormat("OggOpus"));
	const [throttle, setThrottle] = useState(0);
	const [gapStrategy, setGapStrategy] = useState<GapPlaybackStrategy>("hold");
	const [tempoDraft, setTempoDraft] = useState(() => String(controls.tempo));
	const [isEditingTempo, setIsEditingTempo] = useState(false);
	const progressRef = useRef<HTMLDivElement>(null);

	const handleFormatChange = useCallback((nextFormat: StreamFormat) => {
		setFormat(nextFormat);
		setUrl((prevUrl: string) => {
			const trimmed = prevUrl.trim();
			if (!trimmed) {
				return getDefaultUrlForFormat(nextFormat);
			}
			const knownDefaults: StreamFormat[] = [
				"Aac",
				"Flac",
				"Mp3",
				"Mp4Aac",
				"OggFlac",
				"OggOpus",
				"OggVorbis",
				"RawOpusFramed",
				"WebmOpus",
				"WebmVorbis",
			];
			return knownDefaults.some(
				(format) => trimmed === getDefaultUrlForFormat(format),
			)
				? getDefaultUrlForFormat(nextFormat)
				: prevUrl;
		});
	}, []);

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

	const handleLoopModeChange = useCallback(
		(mode: LoopMode) => {
			controls.setLoopMode(mode);
			node.setLoopModeOnNode(mode);
		},
		[controls.setLoopMode, node.setLoopModeOnNode],
	);

	const handleGapStrategyChange = useCallback(
		(strategy: GapPlaybackStrategy) => {
			setGapStrategy(strategy);
			node.setGapPlaybackStrategyOnNode(strategy);
		},
		[node.setGapPlaybackStrategyOnNode],
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
		(v: number) => node.seekPlayhead(v),
		[node],
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
				Stream &amp; decode MP3, AAC, AAC (MP4/M4A), FLAC, Ogg Opus, Ogg Vorbis, framed raw Opus, WebM Opus, or WebM Vorbis in a Web Worker, feeding decoded audio
				directly to the AudioWorklet processor via MessagePort.
			</p>

			<label
				htmlFor="format-select"
				style={{ display: "block", marginTop: "1rem", fontSize: "0.85rem", color: "#94a3b8" }}
			>
				Format
			</label>
			<select
				id="format-select"
				value={format}
				onChange={(e) => handleFormatChange(e.target.value as StreamFormat)}
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
				<option value="Mp3">MP3</option>
				<option value="Aac">AAC (ADTS)</option>
				<option value="Mp4Aac">AAC (MP4/M4A)</option>
				<option value="Flac">FLAC (Lossless)</option>
				<option value="OggFlac">FLAC (OGG)</option>
				<option value="OggOpus">Opus (Ogg) — Recommended</option>
				<option value="OggVorbis">Vorbis (Ogg)</option>
				<option value="RawOpusFramed">Opus (framed raw)</option>
				<option value="WebmOpus">Opus (WebM)</option>
				<option value="WebmVorbis">Vorbis (WebM)</option>
			</select>

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

			<label
				htmlFor="gap-strategy-select"
				style={{ display: "block", marginTop: "1rem", fontSize: "0.85rem", color: "#94a3b8" }}
			>
				Gap Playback Strategy
			</label>
			<select
				id="gap-strategy-select"
				value={gapStrategy}
				onChange={(e) => handleGapStrategyChange(e.target.value as GapPlaybackStrategy)}
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
				<option value="hold">Hold — stall at committed edge</option>
				<option value="silence">Silence — advance through gaps</option>
			</select>

			<div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
				<button type="button" onClick={() => node.stream(url, throttle, format, gapStrategy)}>
					⏬ Stream
				</button>
				<button type="button" onClick={node.play} disabled={node.nodeState !== "initial" || !node.seekableSamples}>
					▶ Play
				</button>
				<button type="button" onClick={node.pause} disabled={!isStreaming}>
					{node.nodeState === "paused" ? "▶ Resume" : "⏸ Pause"}
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
			{node.seekableDuration != null && (
				<p
					style={{
						marginTop: "0.25rem",
						fontSize: "0.8rem",
						color: "#64748b",
					}}
				>
					Decoded seekable: {node.seekableDuration.toFixed(2)}s
				</p>
			)}

			{/* ── Display panel ── */}
			<StreamingDisplayPanel
				nodeState={node.nodeState}
				frameRef={node.frameRef}
				timesLoopedRef={node.timesLoopedRef}
				latency={node.infoLatency}
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
			<StreamingPlayhead
				frameRef={node.frameRef}
				audioDuration={node.audioDuration}
				seekableSamples={node.seekableSamples}
				streamProgress={node.progress}
				disabled={
					node.nodeState === "initial" || node.nodeState === "disposed"
				}
				onChange={handlePlayheadChange}
				playbackGeneration={node.playbackGeneration}
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
