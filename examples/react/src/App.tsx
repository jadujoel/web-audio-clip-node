import {
  GainControl,
  PlaybackRateControl,
  TransportButtons,
  useClipControls,
  useClipNode,
} from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";

export function App() {
  const controls = useClipControls();
  const clip = useClipNode({
    values: controls.values,
    enabled: controls.enabled,
    loop: controls.loop,
    setValue: controls.setValue,
  });

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "2rem auto",
        fontFamily: "system-ui, sans-serif",
        display: "grid",
        gap: "1rem",
      }}
    >
      <h1>ClipNode – React</h1>
      <p>Load a sound, then drive ClipNode with the packaged React controls.</p>
      <TransportButtons
        nodeState={clip.nodeState}
        onStart={clip.start}
        onStop={clip.stop}
        onPause={clip.pause}
        onResume={clip.resume}
        onDispose={clip.dispose}
        onLog={clip.logState}
        onLoadSound={clip.loadSound}
      />
      <PlaybackRateControl
        value={controls.values.playbackRate}
        defaultValue={1}
        enabled={controls.enabled.playbackRate}
        onChange={(value) => {
          controls.setValue("playbackRate", value);
          clip.applyValue("playbackRate", value);
        }}
        onToggle={(enabled) => {
          controls.setEnabled("playbackRate", enabled);
          clip.applyToggle("playbackRate", enabled);
        }}
      />
      <GainControl
        value={controls.values.gain}
        defaultValue={0}
        enabled={controls.enabled.gain}
        onChange={(value) => {
          controls.setValue("gain", value);
          clip.applyValue("gain", value);
        }}
        onToggle={(enabled) => {
          controls.setEnabled("gain", enabled);
          clip.applyToggle("gain", enabled);
        }}
      />
      {clip.statusMessage ? <p>{clip.statusMessage}</p> : null}
    </main>
  );
}
