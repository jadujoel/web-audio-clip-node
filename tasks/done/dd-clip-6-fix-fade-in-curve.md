# dd-clip-6: Fix fade-in not working as expected

## Problem

When setting the fade-in to a long duration (e.g. 20 bars), the audio is audible almost immediately, indicating the fade curve is ineffective for long fades.

## Root Cause Analysis

Two bugs identified:

### Bug 1: Fade-in max is too low (default 4 seconds ≈ 2 bars at 116 BPM)

In `controlDefs.ts`, the fadeIn control has `max: 4` (seconds). At 116 BPM:
- 1 bar = 4 × (60 / 116) ≈ 2.07 seconds
- Max 4 seconds ≈ 1.93 bars

Even though the user can increase the max via the context menu, the default max makes it impossible to set anything close to 20 bars (~41 seconds) without manual override. The default max should be much larger (e.g. 60 seconds ≈ ~29 bars at 116 BPM).

### Bug 2: Cosine fade curve rises too quickly for musical fades

The current fade-in curve in `processor-kernel.ts` (line 806):
```js
const g = Math.cos((Math.PI * (remaining - i)) / doubleFadeInSamples);
```

This is mathematically equivalent to `sin(π·t/2)` where `t = playedSamples / fadeInSamples`. This quarter-sine curve has a **linear onset** — it rises rapidly at the beginning:

| % through fade | gain (linear) | gain (dB) |
|---------------|--------------|-----------|
| 1%            | 0.016        | -36 dB    |
| 5%            | 0.078        | -22 dB    |
| 10%           | 0.156        | -16 dB    |
| 20%           | 0.309        | -10 dB    |
| 50%           | 0.707        | -3 dB     |

For a 20-bar fade (~41 seconds), the audio is at **-16 dB after just 4 seconds** — clearly audible. By 8 seconds in, it's at -10 dB.

A perceptually correct musical fade-in should use a curve that stays quiet longer and ramps up late, such as:
- **Power curve**: `g = t^n` (n=3 gives -60 dB at 10%, -42 dB at 20%)
- **Equal-power (quadratic)**: `g = t^2` (-40 dB at 10%, -28 dB at 20%)
- **Exponential / dB-linear**: `g = 10^((1-t) × floor/20)` (perceptually uniform ramp)

## Fix Plan

### Step 1: Increase default max for fadeIn and fadeOut controls

**File:** `src/audio/controlDefs.ts`

Change the `max` for both `fadeIn` and `fadeOut` from `4` to `60` (seconds). This allows fades up to ~29 bars at 116 BPM without needing to manually override via context menu.

### Step 2: Replace cosine curve with power curve (t³)

**File:** `src/audio/processor-kernel.ts`

Replace the fade-in gain calculation (lines 799–810) from:
```js
const doubleFadeInSamples = fadeInSamples * 2;
for (let i = 0; i < n; i++) {
    const g = Math.cos((Math.PI * (remaining - i)) / doubleFadeInSamples);
    for (let ch = 0; ch < nc; ch++) {
        output0[ch][i] *= g;
    }
}
```

To a cubic power curve:
```js
for (let i = 0; i < n; i++) {
    const t = (playedSamples + i) / fadeInSamples;
    const g = t * t * t; // cubic: slow start, fast finish
    for (let ch = 0; ch < nc; ch++) {
        output0[ch][i] *= g;
    }
}
```

The cubic curve gives:

| % through fade | gain (linear) | gain (dB) |
|---------------|--------------|-----------|
| 1%            | 0.000001     | -60 dB    |
| 5%            | 0.000125     | -39 dB    |
| 10%           | 0.001        | -30 dB    |
| 20%           | 0.008        | -21 dB    |
| 50%           | 0.125        | -9 dB     |
| 80%           | 0.512        | -3 dB     |

This stays effectively silent much longer, producing a perceivable gradual fade-in.

### Step 3: Apply same fix to fade-out curve (symmetry)

**File:** `src/audio/processor-kernel.ts`

The fade-out uses a similar cosine curve (`Math.sin` variant). Replace with a mirrored cubic:
```js
const t = (playedSamples_into_fadeout) / fadeOutSamples;
const g = (1 - t) * (1 - t) * (1 - t); // cubic fade-out
```

Or equivalently, compute based on remaining samples rather than elapsed. The fade-out should mirror the fade-in: fast drop initially, then slow tail to silence.

### Step 4: Update existing tests and add new tests

**File:** `src/audio/processor-kernel.test.ts`

1. Update the existing "initial samples are quieter" test to verify the new curve shape
2. Add test: with a 1-second fade-in, verify gain at 10% is below -25 dB (i.e. < 0.056 linear)
3. Add test: with a 1-second fade-in, verify gain reaches ~1.0 at the end
4. Add test: verify long fade-in (e.g. 10 seconds) keeps signal below -20 dB for the first 30% of the fade
5. Add test: fade-out mirrors fade-in behavior (signal drops to near-silence at end)

### Step 5: Verify no regressions

- Run `bun test` to confirm all tests pass
- Run type checking and lint
- Manual listening test with dev server
