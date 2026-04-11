# Task 10: Fix buzzing when playbackRate reaches zero

## Goal

Stop audible buzzing when playback is active and the playback-rate control is moved to `0`.

The intended behavior after the fix is:

- moving playback rate to `0` should not produce a buzz, zipper noise, or repeated-sample artifact
- the playhead should remain stable while the rate is `0`
- moving the rate away from `0` should resume playback cleanly from the same position
- existing non-zero playback-rate behavior, including reverse playback and very slow playback, should keep working

## Current behavior

The UI intentionally allows `0` as a playback-rate value.

- [src/audio/utils.ts](src/audio/utils.ts) includes `0` in the `playbackRate` slider snaps.
- [src/components/PlaybackRateControl.tsx](src/components/PlaybackRateControl.tsx) allows the slider and text input to send `0` directly.
- [src/hooks/useClipNode.ts](src/hooks/useClipNode.ts) writes the value straight to `node.playbackRate.value`.
- [src/audio/processor-kernel.ts](src/audio/processor-kernel.ts) advances the DSP playhead by the current playback rate inside `findIndexesWithPlaybackRates()`.

At `playbackRate = 0`, the index calculation stops advancing and the same source sample is read for the whole block. In practice that can become an audible artifact when the transport is still running and the output repeatedly emits a frozen sample instead of silence.

There is currently strong playback-rate coverage in [src/audio/sound-output.test.ts](src/audio/sound-output.test.ts), but there is no regression test for exact zero or for transitioning from a non-zero rate to zero during playback.

## Recommended fix direction

Treat exact zero playback rate as a silent hold state in the DSP layer.

Why this is the better first fix:

- it fixes the root cause in audio generation instead of hiding the problem in the UI
- it preserves the existing UI affordance that explicitly snaps to `0`
- it keeps `0.1`, `-0.1`, and other slow non-zero rates available
- it avoids a weaker workaround such as removing the `0` snap point while still leaving typed input and automation free to hit zero

## Plan

1. Reproduce the failure in a regression test before changing behavior.

Add focused playback-rate tests in [src/audio/sound-output.test.ts](src/audio/sound-output.test.ts) that cover:

- exact `playbackRate = 0` while already playing
- transition from `1` to `0` mid-playback
- transition from `0` back to `1` mid-playback

Assertions should verify:

- output becomes silence at zero rate
- `props.playhead` stops advancing while zero rate is active
- playback resumes with sound once a non-zero rate is restored

This should be the primary regression layer because it exercises the pure DSP path directly and already contains the surrounding playback-rate test suite.

2. Add explicit zero-rate handling in the processor kernel.

Update [src/audio/processor-kernel.ts](src/audio/processor-kernel.ts) so that after effective playback rates are derived, the processor detects the exact-zero case and short-circuits to silence rather than generating repeated indexes.

Implementation intent:

- keep the transport alive
- keep the playhead unchanged for the block
- fill the output with silence for zero-rate blocks
- avoid loop/index/crossfade work for that block so the frozen-rate path cannot reintroduce the artifact

Start with exact zero handling, not an aggressive epsilon clamp, because the existing suite explicitly supports very slow playback and that behavior should not be degraded accidentally.

3. Check detune interaction and mixed parameter paths.

Because effective rate is computed as `playbackRate * 2^(detune / 1200)`, confirm that:

- `playbackRate = 0` remains silent even when detune is enabled
- disabling playback-rate indexing still behaves as it does today when only detune is active

If sample-accurate automation within a block exposes a mixed zero/non-zero edge case, handle that deliberately in a follow-up refinement rather than broadening the first fix prematurely.

4. Add a worklet-facing regression, not just a kernel test.

Use [src/audio/audio-worklet-bun.test.ts](src/audio/audio-worklet-bun.test.ts) or a nearby integration-style test to cover the node/worklet path at least once.

The repo does not appear to have a browser e2e harness today, so the smallest meaningful end-to-end regression is an audio-worklet integration test that proves setting `playbackRate.value = 0` does not crash and preserves stable transport behavior.

5. Manually verify the UI behavior after the DSP fix.

In the running app:

- load a clip
- start playback
- move the rate from `1` to `0`
- confirm the buzz is gone and the playhead stops moving
- move the rate back to `1` and confirm playback resumes cleanly

This manual check is still necessary because the reported bug is user-perceived audio behavior, not just an internal state transition.

## Alternatives considered

Remove `0` from the slider snaps and clamp typed input away from zero.

Why not as the primary fix:

- it does not address the DSP bug if zero is reached by automation, direct param writes, or future UI changes
- it changes the control semantics instead of making zero-rate playback well-defined
- it is more of a product workaround than an audio-engine fix

## Verification

After implementation:

- run `bun test`
- run `bun run lint`
- run `bun run typecheck`
- manually verify zero-rate behavior in the app

If the worklet integration test is added separately from the kernel regression, run that targeted file directly first during iteration and then finish with the full suite.

## Acceptance criteria

- Setting playback rate to `0` during playback does not produce buzzing.
- Output is silent while playback rate remains `0`.
- The playhead does not advance while playback rate is `0`.
- Returning to a non-zero playback rate resumes audible playback from the same position.
- Existing reverse and slow non-zero playback behavior still passes.
- Tests covering the zero-rate regression are added and all lint, typecheck, and test commands pass.