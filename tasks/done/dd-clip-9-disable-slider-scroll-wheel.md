# Task 9: Disable scroll-wheel slider adjustments

## Goal

Stop sliders from changing value when the user scrolls the page over them.

The intended interaction after this change is:

- page scrolling should continue to work normally when the pointer is over a slider
- sliders should still support drag, keyboard, double-click reset, snapping, and direct value editing
- there should be no accidental value changes from trackpad or mouse-wheel scrolling

## Current behavior

Wheel handling is implemented centrally in the shared slider.

- [src/components/SnappableSlider.tsx](src/components/SnappableSlider.tsx) defines a `handleWheel()` callback.
- That callback calls `preventDefault()` and converts wheel direction into value changes.
- The component installs a manual `wheel` listener with `{ passive: false }` so it can block native scrolling.

Because the other control UIs reuse `SnappableSlider`, the same behavior currently affects gain, pan, filter, detune, playback-rate, playhead, and audio control sliders.

There is already test coverage that expects wheel-based value changes in [src/components/SnappableSlider.test.tsx](src/components/SnappableSlider.test.tsx), so those assertions will need to be removed or inverted.

## Recommended behavior

Disable wheel-based slider adjustment entirely.

Why:

- it directly fixes the accidental-change problem
- it restores expected page-scroll behavior for both mouse wheels and trackpads
- the app already has better intentional input paths: drag, keyboard, and text entry
- adding modifier-key-gated wheel behavior would add complexity without solving a known requirement

## Plan

1. Remove wheel adjustment from the shared slider.

Update [src/components/SnappableSlider.tsx](src/components/SnappableSlider.tsx) to:

- remove `handleWheel()`
- remove the `useEffect()` that registers the non-passive wheel listener
- leave drag, keyboard, snapping, disabled-state handling, and double-click reset unchanged

Important detail:

- do not replace the current listener with another wheel handler that still calls `preventDefault()`
- native browser scrolling needs to pass through untouched

2. Keep the slider API unchanged unless a real exception appears.

Do not add a new prop such as `allowWheelAdjustment` in this first pass.

Reasoning:

- every current slider inherits behavior from the shared component
- there is no evidence that any existing control should keep wheel-based editing
- adding a prop now would expand API surface and test burden for no clear gain

If a future control truly needs wheel support, it should be opt-in and justified at that call site rather than preserved as the default for all sliders.

3. Replace the existing wheel tests with regression coverage for the fix.

Update [src/components/SnappableSlider.test.tsx](src/components/SnappableSlider.test.tsx) to:

- remove the tests that expect wheel up/down to change values
- remove the test that expects `Shift+wheel` fine adjustment
- add tests asserting wheel events do not call `onChange`
- keep or add a nearby assertion that keyboard arrows still change values so interaction coverage remains strong

This gives the fix a direct regression test and prevents wheel behavior from returning unintentionally.

4. Sanity-check all shared-slider consumers.

Confirm there is no custom wheel behavior layered on top of `SnappableSlider` in:

- [src/components/GainControl.tsx](src/components/GainControl.tsx)
- [src/components/PanControl.tsx](src/components/PanControl.tsx)
- [src/components/FilterControl.tsx](src/components/FilterControl.tsx)
- [src/components/DetuneControl.tsx](src/components/DetuneControl.tsx)
- [src/components/PlaybackRateControl.tsx](src/components/PlaybackRateControl.tsx)
- [src/components/PlayheadSlider.tsx](src/components/PlayheadSlider.tsx)
- [src/components/AudioControl.tsx](src/components/AudioControl.tsx)

No code changes should be required in those files unless one has its own wheel behavior added separately.

## Verification

After implementation:

- run the component tests covering `SnappableSlider`
- run project lint and typecheck
- manually verify in the app that scrolling over sliders moves the page, not the slider value
- manually verify sliders still work via drag and keyboard input

## Acceptance criteria

- Scrolling over a slider no longer changes its value.
- Scrolling over a slider no longer blocks normal page scroll.
- Keyboard, dragging, snapping, disabled behavior, and double-click reset continue to work.
- Test coverage explicitly checks that wheel events do not trigger `onChange`.
- Typecheck, lint, and tests pass after implementation.