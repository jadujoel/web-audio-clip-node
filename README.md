# @jadujoel/web-audio-clip-node

Full-featured AudioWorklet-based audio clip player for the Web Audio API.

Example page at https://jadujoel.github.io/web-audio-clip-node/

## Features

- Playback rate control (-2x to 2x, including reverse)
- Detune (-2400 to +2400 cents)
- Gain (dB scale with equal-power curves)
- Stereo pan
- Highpass / lowpass filters
- Loop with crossfade
- Fade in / fade out
- Streaming buffer support
- Offset & duration control
- React components & hooks (optional)

## Install

```sh
bun install @jadujoel/web-audio-clip-node
```

## Quick Start (Core API)

```ts
import { ClipNode, getProcessorBlobUrl } from "@jadujoel/web-audio-clip-node";

const ctx = new AudioContext();
await ctx.audioWorklet.addModule(getProcessorBlobUrl());

const clip = new ClipNode(ctx);
clip.connect(ctx.destination);

const response = await fetch("audio.opus");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
clip.buffer = buffer;
clip.start();
```

## Quick Start (React)

```tsx
import {
  GainControl,
  PlaybackRateControl,
  TransportButtons,
  useClipControls,
  useClipNode,
} from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";

function Player() {
  const controls = useClipControls();
  const clip = useClipNode({
    values: controls.values,
    enabled: controls.enabled,
    loop: controls.loop,
    setValue: controls.setValue,
  });

  return (
    <>
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
    </>
  );
}
```

## CDN Usage (No Bundler)

```html
<script type="module">
  import { ClipNode, getProcessorCdnUrl } from "https://cdn.jsdelivr.net/npm/@jadujoel/web-audio-clip-node@0.1.1/dist/lib.bundle.js";

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(getProcessorCdnUrl());

  const clip = new ClipNode(ctx);
  clip.connect(ctx.destination);
</script>
```

## Processor Loading Options

| Method | Function | Use case |
|--------|----------|----------|
| Blob URL (default) | `getProcessorBlobUrl()` | Zero-config, works everywhere |
| CDN | `getProcessorCdnUrl("0.1.0")` | No bundler / script-tag usage |
| Self-hosted | `getProcessorModuleUrl(baseUrl)` | You serve `processor.js` yourself |

## Exports

| Entry point | Import path | Contents |
|-------------|-------------|----------|
| Core | `@jadujoel/web-audio-clip-node` | `ClipNode`, types, utils, controls, processor kernel |
| Bundle | `@jadujoel/web-audio-clip-node/bundle` | Single-file ESM bundle for CDN / `<script type="module">` |
| React | `@jadujoel/web-audio-clip-node/react` | Store, hooks, UI components |
| Processor | `@jadujoel/web-audio-clip-node/processor` | Standalone worklet script |
| Styles | `@jadujoel/web-audio-clip-node/styles.css` | CSS for React components |

## Examples

The [`examples/`](examples/) directory contains ready-to-run demos for different setups:

| Example | Description | Build step? |
|---------|-------------|-------------|
| [cdn-vanilla](examples/cdn-vanilla/) | Pure HTML + `<script type="module">` via jsDelivr CDN | No |
| [esm-bundler](examples/esm-bundler/) | Vite + TypeScript with `npm install` | Yes |
| [react](examples/react/) | Vite + React using the built-in hooks & components | Yes |
| [self-hosted](examples/self-hosted/) | Vite + self-hosted `processor.js` via `getProcessorModuleUrl()` | Yes |

## License

MIT
