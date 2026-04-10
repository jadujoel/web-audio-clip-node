# Task 6: Fix fadeout on stop — fades in instead of out

## Bug Description

When the user enables fade-out and presses stop, the audio **fades in** (gets louder) before abruptly cutting off, instead of fading out (getting quieter) as expected.

## Root Cause

The fade-out envelope in `processBlock()` ([processor-kernel.ts](../src/audio/processor-kernel.ts#L817-L830)) has two interrelated bugs:

### Bug 1: Inverted gain curve direction

The gain variable `g` increases over time instead of decreasing:

```typescript
const remaining = fadeOutSamples - remainingSamples; // grows as we approach stopWhen
const g = Math.sin((Math.PI * (remaining - i)) / doubleFadeOutSamples);
```

- When `remaining` is small (start of fade): `g ≈ 0` → audio is **quiet** at start of fade
- When `remaining` is large (end of fade): `g ≈ 1` → audio is **loud** right before cutoff

This is the opposite of what fade-out should do (start loud → end silent).

### Bug 2: Only first `n` samples in each block are affected

```typescript
const n = Math.min(remaining, SAMPLE_BLOCK_SIZE);
for (let i = 0; i < n; i++) { ... }
```

- `remaining = fadeOutSamples - remainingSamples` is small at the start of the fade
- So at the beginning of the fade, only a few samples per block are modified, while the rest play at full volume
- This means the overall volume barely changes early in the fade

### Combined effect

At the start of the fade: almost no samples are modified, and the few that are get gain ≈ 0.
At the end of the fade: all samples are modified, but gain ≈ 1.
Result: audio stays mostly loud, possibly with brief quiet blips, then cuts off abruptly — perceived as a fade-in rather than fade-out.

## Fix

Replace the fade-out loop to iterate over **all** samples in the block and compute gain per-sample based on each sample's distance from `stopWhen`:

```typescript
// --- Fade out ---
if (enableFadeOut && fadeOutDuration > 0) {
    const fadeOutSamples = Math.floor(fadeOutDuration * ctx.sampleRate);
    const remainingSamples = Math.floor(ctx.sampleRate * (stopWhen - ctx.currentTime));
    if (remainingSamples < fadeOutSamples + SAMPLE_BLOCK_SIZE) {
        const doubleFadeOutSamples = fadeOutSamples * 2;
        for (let i = 0; i < SAMPLE_BLOCK_SIZE; i++) {
            const sampleRemaining = remainingSamples - i;
            if (sampleRemaining >= fadeOutSamples) continue; // not yet in fade zone
            const g = sampleRemaining <= 0
                ? 0
                : Math.sin((Math.PI * sampleRemaining) / doubleFadeOutSamples);
            for (let ch = 0; ch < nc; ch++) {
                output0[ch][i] *= g;
            }
        }
    }
}
```

**Why this is correct:**
- `sampleRemaining = remainingSamples - i` = how many samples until `stopWhen` for this specific sample
- When `sampleRemaining = fadeOutSamples` (start of fade): `g = sin(π/2) = 1` → full volume ✓
- When `sampleRemaining = fadeOutSamples/2` (mid fade): `g = sin(π/4) ≈ 0.707` → half power ✓
- When `sampleRemaining = 0` (at stopWhen): `g = sin(0) = 0` → silence ✓
- When `sampleRemaining < 0` (past stopWhen): `g = 0` → silence ✓

## Steps

1. **Fix the fade-out envelope** in `processBlock()` in `processor-kernel.ts` (lines ~817-830)
2. **Improve the existing test** — current test only checks `outputs[0][0][0] < 1.0` which passes even with the broken code. New tests should verify:
   - Samples at the **start** of the fade region are near full volume
   - Samples at the **end** of the fade region are near silence
   - The gain monotonically decreases across the fade
   - A multi-block fade-out produces decreasing RMS energy over successive blocks
3. **Add an e2e-style regression test** that simulates pressing stop with fade-out enabled and verifies the output envelope direction
4. **Run type checking and linting** to confirm no issues

## Files to modify

- `src/audio/processor-kernel.ts` — fix the fade-out loop
- `src/audio/processor-kernel.test.ts` — improve fade-out tests
