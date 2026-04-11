# @jadujoel/web-audio-clip-node

Full-featured AudioWorklet-based audio clip player for the Web Audio API.

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
npm install @jadujoel/web-audio-clip-node
```

## Quick Start (Core API)

```ts
import { ClipNode, getProcessorBlobUrl } from "@jadujoel/web-audio-clip-node";

const ctx = new AudioContext();
await ctx.audioWorklet.addModule(getProcessorBlobUrl());

const clip = new ClipNode(ctx, {
  processorOptions: { sampleRate: ctx.sampleRate },
});
clip.connect(ctx.destination);

const response = await fetch("audio.mp3");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
clip.buffer = buffer;
clip.start();
```

## Quick Start (React)

```tsx
import { useClipNode, useClipControls, TransportButtons, AudioControl } from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";

function Player() {
  const controls = useClipControls();
  const clip = useClipNode({ ...controls });
  return (
    <>
      <TransportButtons />
      <AudioControl />
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

  const clip = new ClipNode(ctx, {
    processorOptions: { sampleRate: ctx.sampleRate },
  });
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

## License

MIT
