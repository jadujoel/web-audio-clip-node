# Task 3: Improve UI Components

## Overview
Comprehensive UX cleanup of the CLIP audio player UI — fix broken controls, remove clutter, create domain-specific components, and add proper visual feedback.

---

## Phase 1: Trivial Fixes (do first, quick wins)

### 1.1 Fix lowpass max off-by-one
- **File:** `src/audio/controlDefs.ts`
- Change lowpass `max: 16385` → `max: 16384`

### 1.2 Hide playhead from user-facing controls
- **File:** `src/audio/controlDefs.ts`
- The `playhead` control (range 0-480000, snap "int") is a developer diagnostic, not a user control. It's driven by RAF updates from the processor.
- Remove `playhead` from `controlDefs` array. Keep the ControlKey type. The value is still tracked in `useClipControls` and displayed in DisplayPanel.

---

## Phase 2: Fix Detune (Critical Bug)

### Problem
The `preset="cents"` creates 49 snap points at 100-cent intervals. The SnappableSlider magnetically snaps to these, making fine pitch adjustment (±1-10 cents) impossible.

### Solution
- **File:** `src/audio/utils.ts` — Change `cents` preset: remove magnetic snap points, keep visual tick marks at octave boundaries only (0, ±1200, ±2400)
- **File:** `src/components/SnappableSlider.tsx` — Separate "visual tick marks" from "magnetic snap points":
  - Add `ticks?: number[]` prop for visual-only reference markers (drawn but don't snap)
  - Existing `snaps` + `enableSnap` continue to work as magnetic snap points
  - When `ticks` are provided, render tick marks but don't use them for snapping
- **File:** `src/audio/controlDefs.ts` — Update detune def: set `step: 1` for single-cent precision
- **File:** `src/audio/utils.ts` — Add `ticks` field to `SliderPreset` interface

### Tests
- Update SnappableSlider tests: verify ticks render without snapping
- Update controlDefs tests: verify detune preset has no magnetic snaps

---

## Phase 3: Disabled Control Visual Feedback (Critical Bug)

### Problem
When `hasToggle=true` and toggle is OFF, the slider still accepts input and shows values as if active. Audio engine ignores the parameter, but the user thinks it's working.

### Solution
- **File:** `src/components/AudioControl.tsx` — When `enabled=false`:
  - Add `aria-disabled="true"` to the slider container
  - Don't fire `onChange` callbacks
  - Apply `.audio-control--disabled` class
- **File:** `src/styles.css` — Add disabled state styles:
  ```css
  .audio-control--disabled {
    opacity: 0.35;
    pointer-events: none; /* on slider and value only, keep toggle clickable */
  }
  ```
- **File:** `src/components/SnappableSlider.tsx` — Add `disabled?: boolean` prop to prevent interaction

### Tests
- AudioControl test: verify disabled state prevents onChange
- AudioControl test: verify disabled class applied
- SnappableSlider test: verify disabled prop prevents pointer/keyboard interaction

---

## Phase 4: Remove Clutter (Refactor AudioControl)

### 4.1 Remove Unit Selector
The `lin/dB/log10/log2` dropdown only transforms the displayed number, not the audio. It's misleading and adds clutter.

- **File:** `src/components/AudioControl.tsx`:
  - Remove `unit` state and `setUnit`
  - Remove `<select className="control-unit">` element
  - Change `displayValue` to use `formatValueText()` directly (which already handles domain-specific formatting via `controlKey`)
  - Remove `getUnitValue` import
- **File:** `src/audio/utils.ts` — Remove `getUnitValue()` function (no longer needed)
- **File:** `src/styles.css` — Remove `.control-unit` styles, update grid to 5 columns

### 4.2 Make Snap Dropdown Conditional
- **File:** `src/audio/controlDefs.ts`:
  - Add `hasSnap?: boolean` to ControlDef interface
  - Set `hasSnap: true` for time-based controls: offset, duration, startDelay, stopDelay, fadeIn, fadeOut, loopStart, loopEnd, loopCrossfade
  - Don't set (defaults to false) for: playbackRate, detune, gain, pan, lowpass, highpass
- **File:** `src/components/AudioControl.tsx`:
  - Only render snap dropdown when `hasSnap` prop is true
  - Pass `hasSnap` through from ControlDef
- **File:** `src/components/ControlSection.tsx` — Pass `hasSnap` to AudioControl
- **File:** `src/styles.css` — Update grid to handle variable columns (snap column hidden when not needed)

### 4.3 Update Grid Layout
After removing unit selector and making snap conditional, the AudioControl layout becomes:
- **With snap:** `[toggle] [label] [snap] [────── slider ──────] [value]`
- **Without snap:** `[toggle] [label] [────── slider ──────] [value]`

Use CSS grid with named areas for clean responsive layout.

### Tests
- AudioControl tests: verify unit selector doesn't render
- AudioControl tests: verify snap dropdown only renders when hasSnap=true
- ControlSection tests: verify hasSnap pass-through
- utils tests: remove getUnitValue tests

---

## Phase 5: Specialized Parameter Components

After Phase 4, AudioControl works well for time-based controls. Now create specialized components for the "Parameters" section where each control type has distinct display and interaction needs.

### 5.1 FilterControl Component (for lowpass & highpass)
- **File:** `src/components/FilterControl.tsx` — NEW
- Layout: `[toggle] [label] [────── log slider ──────] [freq Hz]`
- Props: `{ label, controlKey, value, enabled, defaultValue, min, max, onToggle, onChange }`
- Logarithmic slider (skew=0.25) — inherits from SnappableSlider
- Visual ticks at octave frequencies (64, 128, 256, 512, 1k, 2k, 4k, 8k, 16k) — non-magnetic
- Frequency display formatted as Hz/kHz (e.g., "440 Hz", "2.0 kHz")
- Double-click slider to reset to default
- Disabled visual state when toggle is OFF

### 5.2 GainControl Component
- **File:** `src/components/GainControl.tsx` — NEW
- Layout: `[toggle] [Gain] [────── slider ──────] [dB value]`
- dB display from formatValueText
- Slider with skew=6 (more resolution near 0 dB)
- Visual ticks at -48, -24, -12, -6, -3, 0 dB — non-magnetic
- Double-click to reset to 0 dB

### 5.3 PanControl Component
- **File:** `src/components/PanControl.tsx` — NEW
- Layout: `[toggle] [Pan] [────── bipolar slider ──────] [L/R display]`
- Center-zero visual indicator (line at center of slider)
- Display as "L75" / "C" / "R75" style (compact) using formatValueText
- Visual ticks at -1, -0.5, 0, 0.5, 1 — non-magnetic
- Double-click to reset to center (0)

### 5.4 DetuneControl Component
- **File:** `src/components/DetuneControl.tsx` — NEW
- Layout: `[toggle] [Detune] [────── slider ──────] [cents display]`
- Continuous slider, step=1 for single-cent precision
- Visual ticks at octave boundaries (±1200, ±2400) and zero — non-magnetic
- Display as "+50 cents" / "0 cents" / "-100 cents"
- Double-click to reset to 0

### 5.5 PlaybackRateControl Component
- **File:** `src/components/PlaybackRateControl.tsx` — NEW
- Layout: `[toggle] [Rate] [────── slider ──────] [rate display]`
- Visual ticks at meaningful rates (0.5, 1, 1.5, 2) — can be magnetic (useful snap points)
- Display as "1.00x", "0.50x", "-1.00x"
- Double-click to reset to 1x

### 5.6 Update App.tsx Composition
- **File:** `src/App.tsx`
- ControlSection("Transport") continues to use AudioControl (now TimeControl) for time params
- ControlSection("Loop") same
- "Parameters" section uses specialized components directly:
  ```tsx
  <fieldset className="control-group">
    <legend>Parameters</legend>
    <PlaybackRateControl ... />
    <DetuneControl ... />
    <GainControl ... />
    <PanControl ... />
    <FilterControl label="Lowpass" ... />
    <FilterControl label="Highpass" ... />
  </fieldset>
  ```

### 5.7 Shared Behavior
All specialized components share:
- Toggle enable/disable with visual feedback (from Phase 3)
- Double-click to reset to defaultValue
- Click-to-edit value display
- SnappableSlider internally
- `ticks` for visual reference, `snaps` for magnetic points

Extract a shared base hook or utility if needed: `useControlState(enabled, value, onChange)` that gates onChange behind enabled.

### Tests
- Each new component gets unit tests: rendering, toggle behavior, value changes, disabled state
- Component tests verifying slider interaction

---

## Phase 6: Transport & Display Polish

### 6.1 Slim Transport Buttons
- **File:** `src/components/TransportButtons.tsx`:
  - Reduce button size: height 48px, width auto with padding
  - Keep Log State and Dispose but style them as secondary (smaller, muted color)
  - Group primary buttons (Load, Start, Stop, Pause, Resume) and secondary buttons (Log, Dispose)
- **File:** `src/styles.css` — Add `.btn-secondary` style with reduced prominence

### 6.2 Collapsible Debug Display
- **File:** `src/components/DisplayPanel.tsx`:
  - Show state, current time, and loop count by default
  - Put frame, latency, timeTaken in a collapsible `<details>` element
  - Add CSS for clean collapsed/expanded states

### Tests
- TransportButtons tests: verify button grouping, secondary styling
- DisplayPanel tests: verify collapsible behavior

---

## Phase 7: SnappableSlider Enhancements

### 7.1 Double-Click to Reset
- **File:** `src/components/SnappableSlider.tsx`
- Add `onDoubleClick` handler that calls `onChange(defaultValue)` when `defaultValue` is provided
- Works on the track area, not just the thumb

### 7.2 Visual Tick Marks (non-magnetic)
- **File:** `src/components/SnappableSlider.tsx`
- Add `ticks?: number[]` prop
- Render tick marks the same as snap marks visually, but don't use them in snapping logic
- Existing `snaps` + `enableSnap` unchanged

### 7.3 Alt-Key Visual Hint
- When Alt is held, show a subtle visual indicator (e.g., slider track color change, or "fine" tooltip)
- Brief, non-intrusive

### Tests
- SnappableSlider tests: double-click resets to default
- SnappableSlider tests: ticks render but don't snap
- SnappableSlider tests: alt-key visual hint

---

## Implementation Order

| Step | Phase | What | Why First |
|------|-------|------|-----------|
| 1 | 1.1 | Fix lowpass max | Trivial, do immediately |
| 2 | 1.2 | Remove playhead from controlDefs | Trivial cleanup |
| 3 | 7.1-7.3 | SnappableSlider enhancements | Foundation for all other phases |
| 4 | 2 | Fix detune | Critical bug, needs new ticks prop from step 3 |
| 5 | 3 | Disabled control feedback | Critical bug |
| 6 | 4 | Remove clutter from AudioControl | Clean slate for specialized components |
| 7 | 5 | Create specialized components | Main feature work |
| 8 | 6 | Transport & display polish | Final cleanup |

## Files Summary

### New Files
- `src/components/FilterControl.tsx` + tests
- `src/components/GainControl.tsx` + tests
- `src/components/PanControl.tsx` + tests
- `src/components/DetuneControl.tsx` + tests
- `src/components/PlaybackRateControl.tsx` + tests

### Modified Files
- `src/components/AudioControl.tsx` — remove unit selector, conditional snap, disabled state
- `src/components/SnappableSlider.tsx` — add ticks, disabled, double-click reset, alt hint
- `src/components/ControlSection.tsx` — pass hasSnap
- `src/components/TransportButtons.tsx` — slim buttons, secondary debug buttons
- `src/components/DisplayPanel.tsx` — collapsible debug info
- `src/audio/controlDefs.ts` — fix lowpass max, remove playhead, add hasSnap, fix detune step
- `src/audio/utils.ts` — update presets (cents ticks vs snaps), remove getUnitValue, add ticks to SliderPreset
- `src/styles.css` — disabled state, updated grid, button sizing, details/summary styles
- `src/App.tsx` — use specialized components for Parameters section
- All corresponding test files updated
