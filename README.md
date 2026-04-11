# @jadujoel/web-audio-clip-node

AudioWorklet clip playback for the Web Audio API with pause/resume, reusable start, buffer hot-swap, loop callbacks, loop crossfade, real-time sample playhead control, and sample-accurate fades — without extra nodes.

Live demo: https://jadujoel.github.io/web-audio-clip-node/

## Why this library

`AudioBufferSourceNode` is good at one-shot playback, but it does not give you some things clip-based apps usually need:

- **Pause and resume** — `AudioBufferSourceNode` has no pause; you must stop and recreate
- **Reusable start** — call `start()` again after `stop()` without creating a new node
- **Buffer hot-swap** — assign a new `AudioBuffer` to a playing node and it switches seamlessly
- **Loop callback** when the playhead wraps (`onlooped`)
- **Loop crossfade** built into the source itself
- **Real-time playhead** get/set access in samples
- **Sample-accurate fade in / fade out** without wiring extra gain nodes around every source

`ClipNode` is aimed at those missing pieces while staying small enough to drop into a plain browser app.

## Try It Fast

- Open the live playground: https://jadujoel.github.io/web-audio-clip-node/
- Run all local examples from the repo root with `bun run examples`
- Try the zero-install example in [examples/cdn-vanilla](examples/cdn-vanilla/)

## Features

- AudioWorklet-based clip playback with explicit transport control
- **Pause / resume** and **reusable start** — no need to recreate the node after stopping
- **Buffer hot-swap** — assign `clip.buffer` on a live node and it switches immediately
- `onlooped` callback support so you can react when the clip wraps
- Loop start, loop end, and loop crossfade on the node itself
- Real-time playhead readback and sample-accurate seeking via `clip.playhead`
- Sample-accurate fade in and fade out without external helper nodes
- Playback rate from `-2` to `2`, including reverse playback
- Detune, gain, stereo pan, highpass, and lowpass controls
- Streaming buffer support for incremental writes
- Optional React hooks and ready-made controls

## Install

```sh
npm install @jadujoel/web-audio-clip-node
```

## Quick Start

```ts
import { ClipNode, getProcessorBlobUrl } from "@jadujoel/web-audio-clip-node";

const ctx = new AudioContext();
await ctx.audioWorklet.addModule(getProcessorBlobUrl());

const clip = new ClipNode(ctx);
clip.connect(ctx.destination);

const response = await fetch("/audio/clip.opus");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());

clip.buffer = buffer;
clip.loop = true;
clip.loopStart = 0.5;
clip.loopEnd = 1.75;
clip.loopCrossfade = 0.04;
clip.fadeIn = 0.01;
clip.fadeOut = 0.08;
clip.onlooped = () => {
  console.log("looped at sample", clip.playhead);
};

clip.playbackRate.value = 1;
clip.playhead = 24_000;
clip.start();
```

`clip.playhead` is read and written in samples, so you can scrub to an exact frame position while playback is active.

## React Quick Start

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

## CDN Usage

Use the bundled entry point when you want a single browser import and load the processor from jsDelivr with `getProcessorCdnUrl()`.

```html
<script type="module">
  import {
    ClipNode,
    getProcessorCdnUrl,
  } from "https://cdn.jsdelivr.net/npm/@jadujoel/web-audio-clip-node@0.1.6/dist/lib.bundle.js";

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(getProcessorCdnUrl("0.1.6"));

  const clip = new ClipNode(ctx);
  clip.connect(ctx.destination);
</script>
```

The full no-bundler demo lives in [examples/cdn-vanilla](examples/cdn-vanilla/).

That demo foregrounds the non-standard capabilities: pause/resume, restarting without recreating the node, buffer hot-swap, loop count callbacks, loop crossfade, and direct playhead seeking in samples.

## Processor Loading Options

| Method | Function | Use case |
|--------|----------|----------|
| Blob URL | `getProcessorBlobUrl()` | Default for package consumers who want zero setup |
| CDN | `getProcessorCdnUrl("0.1.6")` | Plain browser usage via jsDelivr |
| Self-hosted | `getProcessorModuleUrl(baseUrl)` | You serve `processor.js` from your own app |

## Entry Points

| Entry point | Import path | Contents |
|-------------|-------------|----------|
| Core | `@jadujoel/web-audio-clip-node` | `ClipNode`, types, utilities, controls, processor kernel |
| Bundle | `@jadujoel/web-audio-clip-node/bundle` | Single-file ESM bundle for CDN or browser module usage |
| React | `@jadujoel/web-audio-clip-node/react` | Store, hooks, and UI components |
| Processor | `@jadujoel/web-audio-clip-node/processor` | Standalone worklet script |
| Styles | `@jadujoel/web-audio-clip-node/styles.css` | CSS for the React components |

## Examples

The [examples](examples/) directory covers the main integration styles.

| Example | Description | Build step? |
|---------|-------------|-------------|
| [cdn-vanilla](examples/cdn-vanilla/) | Single HTML file using the CDN bundle and processor URL | No |
| [esm-bundler](examples/esm-bundler/) | Vite + TypeScript app importing the package directly | Yes |
| [react](examples/react/) | Vite + React with the included hooks and controls | Yes |
| [self-hosted](examples/self-hosted/) | Vite app serving `processor.js` locally via `getProcessorModuleUrl()` | Yes |

## License

MIT
