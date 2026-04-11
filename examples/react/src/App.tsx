import {
  AudioControl,
  TransportButtons,
  useClipControls,
  useClipNode,
} from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";

export function App() {
  const controls = useClipControls();
  useClipNode({ ...controls });

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>ClipNode – React</h1>
      <TransportButtons />
      <AudioControl />
    </div>
  );
}
