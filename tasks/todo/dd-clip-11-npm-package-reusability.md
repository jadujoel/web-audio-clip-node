# Task 11: Make Package Reusable via npm Install & CDN

## Goal
Make everything in `@jadujoel/web-audio-clip-node` easily reusable after `npm install` — the kernel, processor, ClipNode, UI components, hooks, store, utils — and also usable via jsDelivr CDN for the processor worklet.

---

## Step-by-Step Implementation Plan

### Step 1: Create processor code string module
**Why first:** Foundation for Blob URL approach (Tone.js pattern). Everything else depends on this.

- Create `src/audio/processor-code.ts` — a stub file:
  ```ts
  // Generated at build time. Stub for type-checking.
  export const processorCode = "";
  ```
- Update `build.ts` to compile `processor.ts` to a minified string and overwrite `processor-code.ts` with:
  ```ts
  export const processorCode = `...minified source...`;
  ```
- Commit the stub so `tsc --noEmit` works without building first

### Step 2: Update `workletUrl.ts` — flexible processor loading
**Why:** Consumers need multiple ways to load the processor (Blob URL, CDN, custom URL).

Replace current single function with:
```ts
import { processorCode } from "./processor-code";

const PACKAGE_NAME = "@jadujoel/web-audio-clip-node";
const PACKAGE_VERSION = "__VERSION__"; // replaced at build time

/** Blob URL from embedded processor code. Zero-config, default for npm users. */
export function getProcessorBlobUrl(): string {
  const blob = new Blob([processorCode], { type: "text/javascript" });
  return URL.createObjectURL(blob);
}

/** jsDelivr CDN URL. For script-tag / no-bundler usage. */
export function getProcessorCdnUrl(version = PACKAGE_VERSION): string {
  return `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${version}/dist/processor.js`;
}

/** Custom URL relative to a base. For self-hosted processor.js. */
export function getProcessorModuleUrl(baseUrl = document.baseURI): string {
  return new URL("./processor.js", baseUrl).toString();
}
```

Update `workletUrl.test.ts` to cover all three functions.

### Step 3: Create library entry points
**Why:** Clean separation — core users don't pull in React, React users get everything.

Create `src/lib.ts` (core entry):
```ts
// Audio core
export { ClipNode } from "./audio/ClipNode";
export { processorCode } from "./audio/processor-code";
export { getProcessorBlobUrl, getProcessorCdnUrl, getProcessorModuleUrl } from "./audio/workletUrl";

// Types
export type { ClipProcessorOptions, ClipWorkletOptions, ClipNodeState, FrameData, ClipProcessorToggleMessageType, LinkedControlPairKey } from "./audio/types";
export { State } from "./audio/types";

// Utils
export { dbFromLin, linFromDb, float32ArrayFromAudioBuffer, audioBufferFromFloat32Array, presets, generateSnapPoints, getSnappedValue } from "./audio/utils";

// Processor kernel (for advanced / testing)
export { processBlock, handleProcessorMessage, createFilterState, getProperties, SAMPLE_BLOCK_SIZE } from "./audio/processor-kernel";

// Controls
export { controlDefs, DEFAULT_TEMPO, SAMPLE_RATE } from "./controls/controlDefs";
export type { ControlKey } from "./controls/controlDefs";
export { formatValueText, formatTickLabel } from "./controls/formatValueText";
export { getLinkedControlPairForControl, getLinkedControlUpdates } from "./controls/linkedControlPairs";

// Data
export { loadFromCache } from "./data/cache";
export { saveUploadedFile, loadUploadedFile } from "./data/fileStore";
```

Create `src/lib-react.ts` (React entry):
```ts
// Store
export { useClipControls } from "./store/clipStore";

// Hooks
export { useClipNode } from "./hooks/useClipNode";

// Components
export { AudioControl } from "./components/AudioControl";
export { SnappableSlider } from "./components/SnappableSlider";
export { PlayheadSlider } from "./components/PlayheadSlider";
export { GainControl } from "./components/GainControl";
export { DisplayPanel } from "./components/DisplayPanel";
export { TransportButtons } from "./components/TransportButtons";
export { ControlSection } from "./components/ControlSection";
export { ContextMenu } from "./components/ContextMenu";
export { DetuneControl } from "./components/DetuneControl";
export { FilterControl } from "./components/FilterControl";
export { PanControl } from "./components/PanControl";
export { PlaybackRateControl } from "./components/PlaybackRateControl";
```

Note: `lib-react.ts` does NOT re-export from `lib.ts`. Users import core and react entry points separately.

### Step 4: Update build pipeline
**Why:** Need both app build (demo) and library build (npm).

Modify `build.ts`:

```ts
// build.ts additions

async function buildProcessorCodeModule(): Promise<string> {
  const code = await buildProcessor(); // existing function, returns minified string
  const version = (await Bun.file("package.json").json()).version;

  // Write generated processor-code.ts
  await Bun.write(
    "src/audio/processor-code.ts",
    `// AUTO-GENERATED — do not edit. Run 'bun run build:lib' to regenerate.\nexport const processorCode = ${JSON.stringify(code)};\n`
  );

  return code;
}

export async function buildLibrary(): Promise<void> {
  await rm("dist", { force: true, recursive: true });

  // 1. Compile processor and generate embedded code module
  const processorSource = await buildProcessorCodeModule();

  // 2. Write standalone processor.js for CDN usage
  await Bun.write("dist/processor.js", processorSource);

  // 3. Read package version for CDN URL default
  const { version } = await Bun.file("package.json").json();

  // 4. Build ESM library (core + react)
  await Bun.build({
    entrypoints: ["./src/lib.ts", "./src/lib-react.ts"],
    outdir: "dist",
    target: "browser",
    minify: false,
    sourcemap: "linked",
    external: ["react", "react-dom", "react/jsx-runtime", "zustand"],
    define: { "__VERSION__": JSON.stringify(version) },
    naming: "[name].js",
  });

  // 5. Generate .d.ts files
  const tsc = Bun.spawn(["bunx", "tsc", "--project", "tsconfig.build.json"], { stdio: ["inherit", "inherit", "inherit"] });
  await tsc.exited;
}
```

Add `--lib` flag handling or a separate script entry:
```ts
if (import.meta.main) {
  if (process.argv.includes("--lib")) {
    await buildLibrary();
    console.log("Library build completed.");
  } else {
    await build();
    console.log("App build completed.");
  }
}
```

### Step 5: Create `tsconfig.build.json`
**Why:** Generate `.d.ts` declaration files for TypeScript consumers.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": [
    "src/**/*.test.*",
    "src/index.html",
    "src/index.tsx",
    "src/App.tsx",
    "src/App.test.tsx",
    "src/TestPreload.ts"
  ]
}
```

### Step 6: Update package.json
**Why:** Configure npm package metadata, exports map, peer dependencies.

```json
{
  "name": "@jadujoel/web-audio-clip-node",
  "version": "0.1.0",
  "type": "module",
  "description": "Full-featured AudioWorklet clip player with playback rate, detune, gain, pan, filters, looping, fades, crossfade, and streaming buffer support. React components included.",
  "keywords": ["web-audio", "audioworklet", "audio", "clip", "player", "dsp", "react", "worklet"],
  "license": "MIT",
  "author": "joel.lof@icloud.com",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jadujoel/clip.git"
  },
  "exports": {
    ".": {
      "types": "./dist/lib.d.ts",
      "import": "./dist/lib.js"
    },
    "./react": {
      "types": "./dist/lib-react.d.ts",
      "import": "./dist/lib-react.js"
    },
    "./processor": "./dist/processor.js",
    "./styles.css": "./dist/styles.css"
  },
  "main": "./dist/lib.js",
  "types": "./dist/lib.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "scripts": {
    "build": "bun build.ts",
    "build:lib": "bun build.ts --lib",
    "dev": "bun serve.ts",
    "lint": "biome check",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "validate": "bun run build && bun run lint && bun run typecheck && bun test",
    "prepublishOnly": "bun run build:lib"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18",
    "zustand": ">=4"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true },
    "zustand": { "optional": true }
  },
  "devDependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.14",
    "zustand": "5.0.12"
  }
}
```

Note: `react`, `react-dom`, `zustand` move from `dependencies` to `peerDependencies` + `devDependencies`.

### Step 7: Copy styles.css to dist during library build
**Why:** React component consumers need the styles.

Add to `buildLibrary()`:
```ts
await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
```

### Step 8: Update demo app to use `getProcessorModuleUrl`
**Why:** Demo app serves processor.js from dev server, doesn't use Blob URL.

In `src/hooks/useClipNode.ts`, ensure it uses `getProcessorModuleUrl()` (which resolves from `document.baseURI`). This already works. No change needed unless the hook currently uses the bare URL string directly.

### Step 9: Write comprehensive README
**Why:** Users need clear docs to adopt the package.

```markdown
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
npm install @jadujoel/web-audio-clip-node

## Quick Start (Core API)
import { ClipNode, getProcessorBlobUrl } from "@jadujoel/web-audio-clip-node";

const ctx = new AudioContext();
await ctx.audioWorklet.addModule(getProcessorBlobUrl());

const clip = new ClipNode(ctx, { processorOptions: { sampleRate: ctx.sampleRate } });
clip.connect(ctx.destination);

const response = await fetch("audio.mp3");
const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
clip.buffer = buffer;
clip.start();

## Quick Start (React)
import { useClipNode, useClipControls, TransportButtons, AudioControl } from "@jadujoel/web-audio-clip-node/react";
import "@jadujoel/web-audio-clip-node/styles.css";

function Player() {
  const controls = useClipControls();
  const clip = useClipNode({ ...controls });
  return (
    <>
      <TransportButtons ... />
      <AudioControl ... />
    </>
  );
}

## CDN Usage (No Bundler)
<script type="module">
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(
    "https://cdn.jsdelivr.net/npm/@jadujoel/web-audio-clip-node@0.1.0/dist/processor.js"
  );
  // Use ClipNode via import map or inline
</script>

## Processor Loading Options
- **Blob URL (default):** `getProcessorBlobUrl()` — zero-config, works everywhere
- **CDN:** `getProcessorCdnUrl("0.1.0")` — loads from jsDelivr
- **Self-hosted:** `getProcessorModuleUrl(baseUrl)` — you serve processor.js

## API Reference
[ClipNode, hooks, components, controls, utils documented here]
```

### Step 10: Verify & test
1. Run `bun run build:lib` — verify `dist/` has: `lib.js`, `lib-react.js`, `processor.js`, `styles.css`, `*.d.ts`
2. Run `tsc --noEmit` — verify no type errors
3. Run `bun test` — ensure all tests pass
4. Run `bun run build` — ensure demo app still builds
5. Test local install in a scratch project

---

## Files Summary

| File | Action |
|------|--------|
| `src/audio/processor-code.ts` | **Create** — stub, regenerated at build time |
| `src/audio/workletUrl.ts` | **Modify** — add Blob URL + CDN helpers |
| `src/audio/workletUrl.test.ts` | **Modify** — add tests for new functions |
| `src/lib.ts` | **Create** — core library entry point |
| `src/lib-react.ts` | **Create** — React library entry point |
| `build.ts` | **Modify** — add `buildLibrary()`, processor code generation |
| `tsconfig.build.json` | **Create** — declaration generation config |
| `package.json` | **Modify** — exports, peerDeps, files, type, scripts |
| `src/styles.css` | No change — copied to dist during lib build |
| `README.md` | **Rewrite** — full documentation |
| `src/index.tsx` | No change — remains demo app entry |
| `src/App.tsx` | No change — remains demo app |
