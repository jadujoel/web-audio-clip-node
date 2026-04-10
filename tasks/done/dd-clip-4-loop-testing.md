# Task 4: Loop Parameter Combination Testing

## Goal

Exhaustively test all meaningful combinations of `loop`, `loopStart`, `loopEnd`, `loopCrossfade`, and `enableLoopCrossfade` — plus their interactions with `offset`, `duration`, `playbackRate`, `detune`, and `fadeIn`/`fadeOut` — to verify correctness and prevent regressions.

---

## Parameters Under Test

| Parameter | Type | Range | Notes |
|---|---|---|---|
| `loop` | boolean | true / false | Enables/disables looping |
| `loopStart` | number (seconds) | [0, bufferDuration] | Where loop region begins |
| `loopEnd` | number (seconds) | [0, bufferDuration] | Where loop region ends (exclusive) |
| `loopCrossfade` | number (seconds) | [0, loopLength] | Crossfade duration at loop boundaries |
| `enableLoopCrossfade` | boolean | true / false | Toggles crossfade processing |

## Affected Functions

1. **`findIndexesNormal()`** — Index generation with loop wrapping at rate=1
2. **`findIndexesWithPlaybackRates()`** — Index generation with variable/negative rates
3. **`processBlock()`** — Full processing pipeline including crossfade application
4. **`handleProcessorMessage()`** — Setting loop params at runtime
5. **`getProperties()`** — Default value derivation (loopEnd defaults to buffer duration)

---

## Test Infrastructure

### New Helpers (add to test file top)

```ts
/** Simulate N processBlock calls, collecting outputs, messages, and playhead trajectory. */
function simulateBlocks(
  props: Required<ClipProcessorOptions>,
  numBlocks: number,
  params?: Record<string, Float32Array>,
  sampleRate?: number,
): {
  allOutputs: Float32Array[][];
  messages: OutboundMessage[];
  playheadHistory: number[];
}

/** Compute max sample-to-sample delta in a channel (click detector). */
function maxSampleDelta(channel: Float32Array): number

/** Compute energy (sum of squares) of a range within a channel. */
function energy(channel: Float32Array, start?: number, end?: number): number
```

### Existing Helpers (reuse)
- `makeBuffer(length, channels)` — sequential values per channel
- `makeSineBuffer(length, freq, sampleRate, channels)` — sine waves
- `makeOutput(channels, blockSize)` — zero-filled output arrays
- `makeProcessParams()` — default AudioParam values
- `makeFilterState()` — fresh biquad filter states

---

## Test Cases

### Category A: `findIndexesNormal` — Loop Index Generation (unit level)

All tests in this category test ONLY index generation, not audio output.

| # | loop | loopStart | loopEnd | playhead | What to assert |
|---|---|---|---|---|---|
| A1 | false | 0 | 1000 | 0 | Sequential [0..127], ended=false, looped=false |
| A2 | false | 0 | 1000 | 950 | 50 indexes, ended=true |
| A3 | true | 0 | 1000 | 0 | 128 sequential, no wrap |
| A4 | true | 100 | 950 | 900 | Wraps at 950→100, looped=true, indexes[50]=100 |
| A5 | true | 100 | 950 | 950 | Immediate wrap: indexes[0]=100 |
| A6 | true | 0 | 200 | 150 | Short loop: wraps mid-block, verify indexes wrap multiple times if loop < 128 |
| A7 | true | 500 | 500 | 500 | Zero-length loop: no crash (degenerate) |

> Tests A1, A2, A4, A5 overlap with existing tests — include anyway as the new suite should be self-contained.

### Category B: `findIndexesWithPlaybackRates` — Loop + Rate

| # | loop | loopStart | loopEnd | rate | What to assert |
|---|---|---|---|---|---|
| B1 | true | 0 | 1000 | 1.0 | Same as findIndexesNormal |
| B2 | true | 0 | 1000 | 2.0 | Wraps sooner, playhead advances ~256 |
| B3 | true | 0 | 1000 | 0.5 | Wraps later, playhead advances ~64 |
| B4 | true | 0 | 1000 | -1.0 | Reverse: wraps from loopStart → loopEnd |
| B5 | true | 100 | 800 | -1.0 | Reverse with custom loop bounds |
| B6 | true | 0 | 1000 | -2.0 | Fast reverse, wraps sooner |
| B7 | false | 0 | 1000 | 2.0 | No loop, ended sooner |
| B8 | false | 0 | 1000 | -1.0 | Reverse no loop, ended when head < 0 |
| B9 | true | 100 | 900 | varying | a-rate: rate changes across block with wrapping |
| B10 | true | 0 | 1000 | 0.0 | Zero rate: playhead frozen, no indexes change |

### Category C: `processBlock` — Loop Crossfade

All Category C tests use the full `processBlock` pipeline with a buffer filled with 1.0 (or known values) and all filters disabled except crossfade.

| # | loop | loopStart | loopEnd | xfade | enableXfade | playhead | Assert |
|---|---|---|---|---|---|---|---|
| C1 | true | 0.1s | 0.9s | 0.05s | true | loopStart + 10 (xfade-out zone) | Output values > 1.0 (original + blended tail) |
| C2 | true | 0.1s | 0.9s | 0.05s | true | loopEnd - xfade + 10 (xfade-in zone) | Output values > 1.0 (original + blended lead-in) |
| C3 | true | 0.1s | 0.9s | 0.05s | false | in xfade zone | Output exactly 1.0 — no crossfade despite params |
| C4 | true | 0.1s | 0.9s | 0 | true | in loop | Output exactly 1.0 — crossfade=0 means no effect |
| C5 | true | 0.1s | 0.9s | 0.05s | true | middle of loop | Output exactly 1.0 — outside both xfade zones |
| C6 | true | 0.005s | 0.9s | 0.02s | true | near loopEnd | firstIndex < 0 clamped, no crash, no NaN |
| C7 | true | 0.1s | (bufLen-100)/SR | 0.02s | true | loopStart+5 | loopEnd + xfade > sourceLength, no OOB |
| C8 | false | 0.1s | 0.9s | 0.05s | true | mid-buffer | No crossfade when loop=false |
| C9 | true | 0 | bufDur | 0.05s | true | 0 | Crossfade at buffer start |
| C10 | true | 0.1s | 0.9s | > loopLength | true | in loop | Crossfade clamped to loop length |

#### Crossfade Gain Curve Verification (C11-C13)
| # | What | Assert |
|---|---|---|
| C11 | Midpoint of xfade-out zone | cos(π * 0.5 / 2) ≈ 0.707 gain from tail source |
| C12 | Midpoint of xfade-in zone | sin(π * 0.5 / 2) ≈ 0.707 gain from lead-in source |
| C13 | Crossfade with rate=2.0 | Crossfade still applies correctly per-sample at double speed |

### Category D: Multi-Block Loop Lifecycle

Use `simulateBlocks()` helper. Buffer: 48000 samples at SR=48000 (1 second).

| # | Scenario | Blocks | Assert |
|---|---|---|---|
| D1 | Loop with loopStart=0, loopEnd=0.5s → 24000 samples, play ~200 blocks | ~200 | "looped" message at correct intervals; timesLooped increments |
| D2 | Play 3 full loop iterations | enough for 3 wraps | playhead always ∈ [loopStartSamples, loopEndSamples], timesLooped=3 |
| D3 | Loop + crossfade: multi-block through boundary | 5-10 blocks around boundary | No NaN, maxSampleDelta at boundary < threshold |
| D4 | Enable loop mid-playback via "loop" message | 10 | After message: stopWhen=MAX, playback wraps |
| D5 | Disable loop mid-playback | 10 | Playback continues to buffer end, then ended=true |
| D6 | Change loopStart mid-playback | 10 | New loopStart used in next block |
| D7 | Change loopEnd mid-playback | 10 | New loopEnd used in next block |
| D8 | Change loopCrossfade mid-playback | 5 | New crossfade width in effect |
| D9 | toggleLoopCrossfade on/off mid-playback | 5 | Crossfade appears/disappears |

### Category E: Loop + Offset Interaction

| # | loop | offset | loopStart | loopEnd | Assert |
|---|---|---|---|---|---|
| E1 | true | 0 | 0.2s | 0.8s | Plays from 0, enters loop region, loops correctly |
| E2 | true | 0.5s (within loop) | 0.2s | 0.8s | Starts in loop region, loops from first occurrence of loopEnd |
| E3 | true | 0.9s (past loopEnd) | 0.2s | 0.8s | Per implementation: offset clamped/wrapped |
| E4 | false | 0.5s | 0.2s | 0.8s | Offset respected, no looping |

### Category F: Loop + Duration Interaction

| # | loop | duration | loopStart | loopEnd | Assert |
|---|---|---|---|---|---|
| F1 | true | shorter than 1 loop | 0 | 0.5s | Ends before completing first loop |
| F2 | true | exactly 1 loop length | 0 | 0.5s | Completes exactly 1 loop then ends |
| F3 | true | 2.5× loop length | 0 | 0.5s | Loops twice, ends mid-third |
| F4 | true | MAX_SAFE_INTEGER | 0 | 0.5s | Loops indefinitely (default with loop=true) |

### Category G: Edge Cases & Boundary Conditions

| # | Scenario | Assert |
|---|---|---|
| G1 | loopStart > loopEnd | Per W3C: treat as full buffer loop (current impl uses raw values — verify no crash at minimum) |
| G2 | loopEnd > buffer duration | Clamped to buffer length in processBlock |
| G3 | loopStart < 0 | Clamped to 0 (floor) |
| G4 | Buffer shorter than 128 samples + loop | Wraps correctly, no OOB |
| G5 | Very short loop (64 samples) at rate=1 | Multiple wraps per block |
| G6 | loopCrossfade negative | enableLoopCrossfade derived as false (crossfade > 0) |
| G7 | Empty buffer + loop=true | Outputs silence, no crash |
| G8 | Mono buffer + loop + crossfade | monoToStereo applied after crossfade, output is stereo |
| G9 | Loop + playbackRate + detune combined | computedPlaybackRate = rate * 2^(detune/1200) used for wrapping |
| G10 | NaN in buffer within loop region | checkNans catches and replaces, no propagation |
| G11 | loopStart == 0, loopEnd == 0 | Per W3C: loopEnd=0 means loop entire buffer |

### Category H: Property Defaults & Message Handling

| # | Scenario | Assert |
|---|---|---|
| H1 | getProperties with no loopEnd → defaults to bufLen/sampleRate | Verified |
| H2 | getProperties with explicit loopEnd | Respected |
| H3 | handleProcessorMessage "loopCrossfade" sets value | property updated |
| H4 | handleProcessorMessage "loop" true on Started → extends stopWhen | stopWhen = MAX |
| H5 | handleProcessorMessage "loop" true on Scheduled → extends stopWhen | stopWhen = MAX |
| H6 | toggleLoopCrossfade toggles enable flag | verified both directions |
| H7 | start message with loop=true → duration = MAX_SAFE_INTEGER | verified |
| H8 | start message resets timesLooped to 0 | verified |

> Tests H1-H8 mostly exist already in the current test file. Include here for completeness; mark duplicates in implementation.

---

## Implementation Order

1. **Add helpers** (`simulateBlocks`, `maxSampleDelta`, `energy`) at the top of the test file
2. **Category A** (unit: findIndexesNormal) — fast, no processBlock needed
3. **Category B** (unit: findIndexesWithPlaybackRates) — fast
4. **Category H** (property/message) — fast, mostly already covered
5. **Category C** (crossfade unit) — needs processBlock but single-block
6. **Category E** (offset interaction) — single-block processBlock
7. **Category F** (duration interaction) — multi-block
8. **Category D** (multi-block lifecycle) — most complex
9. **Category G** (edge cases) — mix of unit and processBlock

## Success Criteria

- All ~60 tests pass
- No NaN in any output (except explicit NaN-in-buffer test)
- All indexes within [0, bufferLength) for all loop configurations
- Crossfade gain curve matches cos/sin equal-power shape
- playhead never escapes loop bounds during looped playback
- Zero type errors, zero lint errors
