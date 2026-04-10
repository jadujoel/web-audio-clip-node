# Task: Refactor processor.ts for Testability

## Goal

Extract all testable logic from `processor.ts` into a platform-independent `processor-kernel.ts` module, leaving `processor.ts` as a thin AudioWorklet shell. Write comprehensive tests for the kernel.

---

## Problem

`processor.ts` (~900 lines) is untestable because:

1. It declares and depends on AudioWorklet globals (`AudioWorkletProcessor`, `registerProcessor`, `currentTime`, `currentFrame`, `sampleRate`) that don't exist outside AudioWorkletGlobalScope.
2. All DSP helpers and state logic are module-private (not exported).
3. Filter state is stored in module-level mutable singletons.
4. `registerProcessor()` runs as a side effect on import.
5. Types are duplicated between `processor.ts` and `types.ts`.

---

## Solution: Extract Kernel Pattern

### New file structure

```
src/audio/
  types.ts                    — All shared types (expanded with types from processor.ts)
  processor-kernel.ts         — Pure DSP logic, state machine, all filters (NO platform deps)
  processor.ts                — Thin AudioWorklet shell (~60 lines)
  processor-kernel.test.ts    — Tests for the kernel
```

---

## Step 1: Move all types to `types.ts`

Move the following from `processor.ts` to `types.ts`:
- `ClipProcessorOnmessageEvent`, `ClipProcessorOnmessage`
- `ProcessorWorkletOptions`
- `ClipProcessorStateMap`
- `BlockParameters`, `BlockReturnState`
- All message types: `ClipProcessorMessageRx`, `ClipProcessorMessageType`, `ClipProcessorBufferMessageRx`, `ClipProcessorStartMessageRx`, etc.

Remove the duplicated `State` const and `ClipProcessorState` type from `processor.ts` (already in `types.ts`).

---

## Step 2: Create `processor-kernel.ts`

All functions accept `sampleRate` as an explicit parameter where needed (never read from a global). All functions are exported.

### 2a. Constants

```ts
export const SAMPLE_BLOCK_SIZE = 128;
```

### 2b. Properties & offset

```ts
export function getProperties(opts: ClipProcessorOptions, sampleRate: number): Required<ClipProcessorOptions>
export function setOffset(properties: Required<ClipProcessorOptions>, offset: number | undefined, sampleRate: number): number
```

### 2c. Index calculation (already pure, just export)

```ts
export function findIndexesNormal(p: BlockParameters): BlockReturnState
export function findIndexesWithPlaybackRates(p: BlockParameters): BlockReturnState
```

### 2d. Buffer operations (already pure, just export)

```ts
export function fill(target: Float32Array[], source: Float32Array[], indexes: number[]): void
export function fillWithSilence(buffer: Float32Array[]): void
export function monoToStereo(signal: Float32Array[]): void
export function copy(source: Float32Array[], target: Float32Array[]): void
export function checkNans(output: Float32Array[]): number
```

### 2e. Filters with injected state

```ts
export interface BiquadState { x_1: number; x_2: number; y_1: number; y_2: number }

export function createFilterState(): BiquadState[] // returns 2-element array of zeroed state

export function gainFilter(arr: Float32Array[], gains: Float32Array): void
export function panFilter(signal: Float32Array[], pans: Float32Array): void
export function lowpassFilter(buffer: Float32Array[], cutoffs: Float32Array, sampleRate: number, states: BiquadState[]): void
export function highpassFilter(buffer: Float32Array[], cutoffs: Float32Array, sampleRate: number, states: BiquadState[]): void
```

### 2f. Envelope functions (extracted from inline process code)

```ts
export function applyLoopCrossfade(output: Float32Array[], buffer: Float32Array[], params: {
  playhead: number; loop: boolean; loopStartSamples: number; loopEndSamples: number;
  xfadeNumSamples: number; sourceLength: number; nc: number;
}): void

export function applyFadeIn(output: Float32Array[], params: {
  fadeInSamples: number; playedSamples: number; nc: number;
}): void

export function applyFadeOut(output: Float32Array[], params: {
  fadeOutSamples: number; stopWhen: number; currentTime: number; sampleRate: number; nc: number;
}): void
```

### 2g. Message handler

```ts
export interface OutboundMessage { type: string; data?: unknown }

export function handleProcessorMessage(
  properties: Required<ClipProcessorOptions>,
  message: { type: string; data?: unknown },
  currentTime: number,
  sampleRate: number,
): OutboundMessage[]
```

This function **mutates** `properties` in-place and returns an array of messages to post back. Tests assert both the mutated state and the returned messages.

Disposal is handled by returning a `{ type: "disposed" }` message and setting state + clearing buffer. The shell handles `port.close()`.

### 2h. Process block

```ts
export interface ProcessContext {
  currentTime: number;
  currentFrame: number;
  sampleRate: number;
}

export interface ProcessResult {
  keepAlive: boolean;
  messages: OutboundMessage[];
}

export function processBlock(
  props: Required<ClipProcessorOptions>,
  outputs: Float32Array[][],
  parameters: Record<string, Float32Array>,
  ctx: ProcessContext,
  filterState: { lowpass: BiquadState[]; highpass: BiquadState[] },
): ProcessResult
```

- Mutates `props` in-place (playhead, playedSamples, state, timesLooped)
- Writes to `outputs` in-place
- Returns `{ keepAlive, messages }` — the shell posts messages and returns keepAlive
- Does NOT handle frame reporting (that's the shell's job)

---

## Step 3: Slim down `processor.ts` to a thin shell (~60 lines)

```ts
// AudioWorklet ambient declarations
declare const currentTime: number;
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor { ... }
declare function registerProcessor(...): void;

import { getProperties, handleProcessorMessage, processBlock, createFilterState } from './processor-kernel';
import type { ProcessorWorkletOptions } from './types';

class ClipProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { /* same 6 params */ }

  properties;
  filterState = { lowpass: createFilterState(), highpass: createFilterState() };
  lastFrameTime = 0;

  constructor(options?: ProcessorWorkletOptions) {
    super(options);
    this.properties = getProperties(options?.processorOptions, sampleRate);
    this.port.onmessage = (ev) => {
      const messages = handleProcessorMessage(this.properties, ev.data, currentTime, sampleRate);
      for (const msg of messages) this.port.postMessage(msg);
      if (this.properties.state === State.Disposed) this.port.close();
    };
  }

  process(_inputs, outputs, parameters) {
    const result = processBlock(this.properties, outputs, parameters, { currentTime, currentFrame, sampleRate }, this.filterState);
    for (const msg of result.messages) this.port.postMessage(msg);
    // Frame reporting
    const timeTaken = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;
    this.port.postMessage({ type: "frame", data: [currentTime, currentFrame, Math.floor(this.properties.playhead), timeTaken * 1000] });
    return result.keepAlive;
  }
}

registerProcessor("ClipProcessor", ClipProcessor);
```

This file:
- Is the only file with AudioWorklet global declarations
- Is the only file with `registerProcessor` side effect
- Has zero DSP logic — only wiring
- Will NOT be unit-tested (verified via e2e/manual tests)

---

## Step 4: Write tests in `processor-kernel.test.ts`

### Test infrastructure
- Use Bun's built-in test runner (`bun test`)
- No AudioWorklet mocks needed — the kernel has zero platform dependencies
- Create small Float32Array test buffers (e.g., sine waves, ramps, constant signals)
- Create fresh filter state via `createFilterState()` in each test for determinism

### Test categories

#### A. `getProperties` / `setOffset`
1. Returns all required fields with sensible defaults
2. Respects provided options (loop, fadeIn, etc.)
3. `setOffset` with positive, negative, and oversized values
4. `setOffset` with undefined → 0
5. Works correctly with different sampleRate values

#### B. `findIndexesNormal`
1. Normal (non-loop) playback: sequential indexes, correct playhead advance
2. End of buffer → `ended=true`, indexes truncated
3. Loop wraps from loopEnd → loopStart
4. Playhead at exact loop boundary
5. Empty range (playhead >= bufferLength, no loop)

#### C. `findIndexesWithPlaybackRates`
1. Rate=1 matches `findIndexesNormal` behavior
2. Rate=2 skips every other sample
3. Rate=0.5 reads each sample twice (via floor)
4. Negative rate plays in reverse
5. Loop wrapping with positive rate
6. Loop wrapping with negative rate (wraps to loopEnd)
7. Rate changes across the block (a-rate array of 128 values)

#### D. Buffer operations
1. `fill`: maps indexes to correct output samples, zeroes remainder
2. `fillWithSilence`: all channels zeroed
3. `monoToStereo`: duplicates mono channel, output has 2 channels
4. `copy`: multi-channel copy preserves all data
5. `checkNans`: counts and replaces NaN values with 0

#### E. Filters
1. `gainFilter` with k-rate (length=1): scales all samples
2. `gainFilter` with a-rate: per-sample gain
3. `gainFilter` with gain=1: no change
4. `panFilter` center: no attenuation
5. `panFilter` hard left: right channel zeroed
6. `panFilter` hard right: left channel zeroed
7. `lowpassFilter`: known low-frequency signal passes through mostly unchanged
8. `lowpassFilter`: known high-frequency signal is significantly attenuated
9. `highpassFilter`: known high-frequency signal passes through
10. `highpassFilter`: known low-frequency signal is attenuated
11. Filter state isolation: fresh `createFilterState()` per test gives deterministic results
12. `lowpassFilter` at cutoff=20000: early return (no filtering)
13. `highpassFilter` at cutoff=20: early return (no filtering)

#### F. Envelopes
1. `applyFadeIn`: initial samples are quieter, later samples full volume
2. `applyFadeIn`: no-op when playedSamples > fadeInSamples
3. `applyFadeOut`: samples near stopWhen are attenuated
4. `applyFadeOut`: no-op when far from stopWhen
5. `applyLoopCrossfade`: blending at loop boundaries uses sin/cos curves
6. `applyLoopCrossfade`: no-op when not within loop range or crossfade disabled

#### G. `handleProcessorMessage`
1. `buffer` message sets properties.buffer
2. `start` message → sets state=Scheduled, returns `[{type:"scheduled"}]`, resets playedSamples/timesLooped
3. `start` with when/offset/duration options
4. `start` with loop=true → duration=MAX_SAFE_INTEGER
5. `stop` message → sets state=Stopped, returns `[{type:"stopped"}]`
6. `stop` when already ended → no-op
7. `pause` → state=Paused, returns `[{type:"paused"}]`
8. `resume` → state=Started, returns `[{type:"resume"}]`
9. `dispose` → state=Disposed, buffer cleared, returns `[{type:"disposed"}]`
10. `loop` toggle: sets loop, adjusts stopWhen/duration when started
11. `loopStart`, `loopEnd`, `loopCrossfade`, `playhead`, `fadeIn`, `fadeOut` property setters
12. All toggle messages: toggleGain, togglePan, toggleLowpass, toggleHighpass, etc.
13. `logState` message (no-op for kernel, returns empty array)

#### H. `processBlock` (integration-level)
1. State=Disposed → returns keepAlive=false
2. State=Initial → outputs silence, keepAlive=true
3. State=Ended → outputs silence, keepAlive=true
4. State=Scheduled, time not reached → silence
5. State=Scheduled, time reached → transitions to Started, returns "started" message
6. Normal playback: correct samples from buffer appear in output
7. Playback through end of buffer → Ended state + "ended" message
8. Loop playback: wraps correctly, returns "looped" message
9. Pause: silence after pauseWhen
10. Stop: transitions to Ended after stopWhen
11. Fade in/out applied when enabled
12. Loop crossfade applied when enabled
13. Filter chain: lowpass, highpass, gain, pan applied in correct order
14. Mono buffer → auto-stereo conversion
15. Multi-output: copies to additional outputs
16. NaN detection and recovery
17. Playhead and playedSamples updated correctly after block

---

## Implementation Order

1. Create `types.ts` additions (move types from processor.ts)
2. Create `processor-kernel.ts` (extract all functions, add sampleRate params, export)
3. Rewrite `processor.ts` as thin shell (imports kernel, registers)
4. Verify: `bun run typecheck` passes
5. Write `processor-kernel.test.ts`
6. Verify: `bun test` passes with all tests green
7. Manual smoke test: run `bun run dev` and verify audio playback still works

---

## What stays untested (and why that's OK)

The thin `processor.ts` shell (~60 lines) remains untested by unit tests because it requires AudioWorkletGlobalScope. This is acceptable because:
- It contains zero logic — only wiring (property reads, message posting)
- Its correctness is verified by the e2e tests and manual testing
- Any bug in the shell would be a wiring mistake caught immediately by playback testing

---

## Risk Mitigation

- **Behavioral regression**: The refactoring is purely structural — no algorithm changes. Each extracted function preserves identical logic.
- **Filter state isolation**: Moving from module-level singletons to injected state objects is the only semantic change. Tests will verify filter behavior is identical.
- **Import side effects**: The kernel module has no side effects. Only the shell calls `registerProcessor`.
