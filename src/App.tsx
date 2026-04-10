import { useCallback, useEffect, useRef, useState } from "react";
import { ClipNode } from "./audio/ClipNode";
import { loadFromCache } from "./audio/cache";
import type { ClipNodeState, FrameData } from "./audio/types";
import { float32ArrayFromAudioBuffer, linFromDb } from "./audio/utils";
import { AudioControl } from "./components/AudioControl";

// ---------------------------------------------------------------------------
// Control configuration
// ---------------------------------------------------------------------------

interface ControlDef {
  key: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  precision?: number;
  snap?: string;
  preset?: string;
  transform?: string;
  title?: string;
  hasToggle?: boolean;
}

const TEMPO = 116;
const SAMPLE_RATE = 48000;

const controlDefs: ControlDef[] = [
  { key: "playhead", label: "Playhead", min: 0, max: 480000, defaultValue: 0, precision: 1, snap: "int", title: "Current sample position of buffer playback." },
  { key: "offset", label: "Offset", min: 0, max: 4, defaultValue: 0, snap: "bar", title: "Start position in the buffer (seconds)." },
  { key: "duration", label: "Duration", min: -1, max: 40, defaultValue: -1, title: "How long to play before auto-stopping (seconds). -1 for full length." },
  { key: "startDelay", label: "StartDelay", min: 0, max: 4, defaultValue: 0, snap: "beat", title: "Delay before starting (seconds)." },
  { key: "stopDelay", label: "StopDelay", min: 0, max: 4, defaultValue: 0, snap: "beat", title: "Delay before stopping (seconds)." },
  { key: "fadeIn", label: "FadeIn", min: 0, max: 4, defaultValue: 0, snap: "beat", hasToggle: true, title: "Fade-in duration (seconds)." },
  { key: "fadeOut", label: "FadeOut", min: 0, max: 4, defaultValue: 0, snap: "beat", hasToggle: true, title: "Fade-out duration (seconds)." },
];

const loopControlDefs: ControlDef[] = [
  { key: "loopStart", label: "LoopStart", min: 0, max: 1, defaultValue: 0, snap: "bar" },
  { key: "loopEnd", label: "LoopEnd", min: 0, max: 1, defaultValue: 0, snap: "bar" },
  { key: "loopCrossfade", label: "LoopCrossfade", min: 0, max: 1, defaultValue: 0, snap: "beat", hasToggle: true },
];

const paramDefs: ControlDef[] = [
  { key: "playbackRate", label: "PlaybackRate", min: -2, max: 2, defaultValue: 1, precision: 2, preset: "playbackRate", hasToggle: true, title: "Playback speed. Negative for reverse." },
  { key: "detune", label: "Detune", min: -2400, max: 2400, defaultValue: 0, precision: 4, preset: "cents", hasToggle: true, title: "Pitch shift in cents." },
  { key: "gain", label: "Gain", min: -100, max: 0, defaultValue: 0, precision: 3, preset: "gain", transform: "dB", hasToggle: true, title: "Amplitude in dB." },
  { key: "pan", label: "Pan", min: -1, max: 1, defaultValue: 0, preset: "pan", hasToggle: true, title: "-1 full left, 1 full right." },
  { key: "lowpass", label: "Lowpass", min: 32, max: 16385, defaultValue: 16384, preset: "hertz", hasToggle: true, title: "Lowpass cutoff frequency." },
  { key: "highpass", label: "Highpass", min: 32, max: 16384, defaultValue: 32, preset: "hertz", hasToggle: true, title: "Highpass cutoff frequency." },
];

const allDefs = [...controlDefs, ...loopControlDefs, ...paramDefs];

function buildDefaults() {
  const values: Record<string, number> = {};
  const snaps: Record<string, string> = {};
  const enabled: Record<string, boolean> = {};
  for (const d of allDefs) {
    values[d.key] = d.defaultValue;
    snaps[d.key] = d.snap ?? "none";
    enabled[d.key] = true;
  }
  return { values, snaps, enabled };
}

// ---------------------------------------------------------------------------
// Node ↔ control binding
// ---------------------------------------------------------------------------

function applyValue(node: ClipNode, key: string, value: number) {
  switch (key) {
    case "playhead": node.playhead = value; break;
    case "offset": node.offset = value; break;
    case "duration": node.duration = value; break;
    case "loopStart": node.loopStart = value; break;
    case "loopEnd": node.loopEnd = value; break;
    case "loopCrossfade": node.loopCrossfade = value; break;
    case "fadeIn": node.fadeIn = value; break;
    case "fadeOut": node.fadeOut = value; break;
    case "playbackRate": node.playbackRate.value = value; break;
    case "detune": node.detune.value = value; break;
    case "gain": node.gain.value = linFromDb(value); break;
    case "pan": node.pan.value = value; break;
    case "lowpass": node.lowpass.value = value; break;
    case "highpass": node.highpass.value = value; break;
  }
}

function applyToggle(node: ClipNode, key: string, on: boolean) {
  switch (key) {
    case "fadeIn": node.toggleFadeIn(on); break;
    case "fadeOut": node.toggleFadeOut(on); break;
    case "loopCrossfade": node.toggleLoopCrossfade(on); break;
    case "playbackRate": node.togglePlaybackRate(on); break;
    case "detune": node.toggleDetune(on); break;
    case "gain": node.toggleGain(on); break;
    case "pan": node.togglePan(on); break;
    case "lowpass": node.toggleLowpass(on); break;
    case "highpass": node.toggleHighpass(on); break;
  }
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "clip-node-state";

interface PersistedState {
  values: Record<string, number>;
  snaps: Record<string, string>;
  enabled: Record<string, boolean>;
}

function saveState(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(): PersistedState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function searchParamsIncludes(key: string) {
  return new URLSearchParams(window.location.search).has(key);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const defaults = buildDefaults();
  const persisted = searchParamsIncludes("disable-state") ? null : loadState();

  const [values, setValues] = useState<Record<string, number>>(persisted?.values ?? defaults.values);
  const [snaps, setSnaps] = useState<Record<string, string>>(persisted?.snaps ?? defaults.snaps);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(persisted?.enabled ?? defaults.enabled);
  const [loop, setLoop] = useState(false);

  const [nodeState, setNodeState] = useState<ClipNodeState>("initial");
  const [infoCurrentTime, setInfoCurrentTime] = useState("0");
  const [infoCurrentFrame, setInfoCurrentFrame] = useState("0");
  const [infoTimesLooped, setInfoTimesLooped] = useState("0");
  const [infoLatency, setInfoLatency] = useState("unknown");
  const [infoTimeTaken, setInfoTimeTaken] = useState("unknown");

  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<ClipNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const frameRef = useRef<FrameData | null>(null);

  // Save state on unload
  useEffect(() => {
    if (searchParamsIncludes("disable-state")) return;
    const handler = () => saveState({ values, snaps, enabled });
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [values, snaps, enabled]);

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
        setValues((prev) => (prev.playhead === ph ? prev : { ...prev, playhead: ph }));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // --- Audio helpers ---

  const ensureContext = useCallback(async () => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await ctx.audioWorklet.addModule("/processor.js");
    ctxRef.current = ctx;
    return ctx;
  }, []);

  const decodeAudio = useCallback(async (source: string | ArrayBuffer) => {
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
    return decoded;
  }, [ensureContext]);

  const handleLoadSound = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ab = await file.arrayBuffer();
      const buf = await decodeAudio(ab);
      bufferRef.current = buf;
      // Update max ranges based on buffer
      setValues((prev) => ({
        ...prev,
        playhead: 0,
      }));
    };
    input.click();
  }, [decodeAudio]);

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
          enableLoopCrossfade: enabled.loopCrossfade,
        },
      });

      node.connect(ctx.destination);

      node.onstatechange = (s) => setNodeState(s);
      node.onlooped = () => setInfoTimesLooped(node.timesLooped.toString());
      node.onframe = (data) => { frameRef.current = data; };

      node.addEventListener("processorerror", (e) => console.error("processor error", e));

      // Apply all current values
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
    // We intentionally capture current values at creation time
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loop, values, enabled],
  );

  // --- Button handlers ---

  const handleStart = useCallback(async () => {
    const ctx = await ensureContext();
    const buffer = bufferRef.current;
    if (!buffer) {
      alert("Load a sound file first.");
      return;
    }

    if (!nodeRef.current) {
      nodeRef.current = createNode(ctx, buffer);
    }

    ctx.resume();
    const node = nodeRef.current;
    node.start(
      ctx.currentTime + values.startDelay,
      values.offset,
      values.duration,
    );
  }, [ensureContext, createNode, values.startDelay, values.offset, values.duration]);

  const handleStop = useCallback(() => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    if (!ctx || !node) return;
    node.stop(ctx.currentTime + values.stopDelay);
  }, [values.stopDelay]);

  const handlePause = useCallback(() => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    if (!ctx || !node) return;
    node.pause(ctx.currentTime + values.stopDelay);
  }, [values.stopDelay]);

  const handleResume = useCallback(() => {
    const ctx = ctxRef.current;
    const node = nodeRef.current;
    if (!ctx || !node) return;
    node.resume(ctx.currentTime + values.startDelay);
  }, [values.startDelay]);

  const handleDispose = useCallback(() => {
    nodeRef.current?.dispose();
    nodeRef.current = null;
    setNodeState("disposed");
  }, []);

  const handleLog = useCallback(() => {
    nodeRef.current?.logState();
  }, []);

  // --- Control change handlers ---

  const handleValueChange = useCallback(
    (key: string, val: number) => {
      setValues((prev) => ({ ...prev, [key]: val }));
      const node = nodeRef.current;
      if (node) applyValue(node, key, val);
    },
    [],
  );

  const handleToggle = useCallback(
    (key: string, on: boolean) => {
      setEnabled((prev) => ({ ...prev, [key]: on }));
      const node = nodeRef.current;
      if (node) applyToggle(node, key, on);
    },
    [],
  );

  const handleSnapChange = useCallback(
    (key: string, snap: string) => {
      setSnaps((prev) => ({ ...prev, [key]: snap }));
    },
    [],
  );

  const handleLoopChange = useCallback(
    (checked: boolean) => {
      setLoop(checked);
      const node = nodeRef.current;
      if (node) node.loop = checked;
    },
    [],
  );

  // --- Render helpers ---

  const renderControl = (def: ControlDef) => (
    <AudioControl
      key={def.key}
      label={def.label}
      min={def.min}
      max={def.max}
      value={values[def.key]}
      precision={def.precision}
      tempo={TEMPO}
      snap={snaps[def.key]}
      preset={def.preset}
      transform={def.transform}
      title={def.title}
      enabled={enabled[def.key]}
      hasToggle={def.hasToggle}
      onChange={(v) => handleValueChange(def.key, v)}
      onToggle={(on) => handleToggle(def.key, on)}
      onSnapChange={(s) => handleSnapChange(def.key, s)}
    />
  );

  return (
    <main>
      <hr />
      <section id="display">
        <code>State:</code>
        <output>{nodeState}</output>
        <br />
        <code>CurrentTime:</code>
        <output>{infoCurrentTime}</output>
        <code>CurrentFrame:</code>
        <output>{infoCurrentFrame}</output>
        <code>TimesLooped:</code>
        <output>{infoTimesLooped}</output>
        <br />
        <code>Latency:</code>
        <output>{infoLatency}</output>
        <code>TimeTaken:</code>
        <output>{infoTimeTaken}</output>
      </section>
      <hr />

      <section id="buttons">
        <button type="button" onClick={handleStart}>Start</button>
        <button type="button" onClick={handleStop}>Stop</button>
        <button type="button" onClick={handlePause}>Pause</button>
        <button type="button" onClick={handleResume}>Resume</button>
        <button type="button" onClick={handleDispose}>Dispose</button>
        <button type="button" onClick={handleLog}>Log State</button>
        <button type="button" onClick={handleLoadSound}>Load Sound</button>
      </section>
      <hr />

      <section id="controls">
        {controlDefs.map(renderControl)}

        <div className="loop-row">
          <label htmlFor="loop">Loop</label>
          <input
            type="checkbox"
            id="loop"
            checked={loop}
            onChange={(e) => handleLoopChange(e.target.checked)}
          />
        </div>

        {loopControlDefs.map(renderControl)}
        {paramDefs.map(renderControl)}
      </section>
      <hr />
    </main>
  );
}
