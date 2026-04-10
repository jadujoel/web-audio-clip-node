# Task: Improve UI Components

## Summary

Overhaul the UI components of the Clip audio worklet test harness to meet accessibility standards, improve usability with audio-domain interactions, clean up architecture, and add test coverage.

---

## Current State

| Component | Lines | Issues |
|-----------|-------|--------|
| `App.tsx` | ~650 | Monolith mixing audio logic, state, persistence, rendering |
| `AudioControl.tsx` | ~100 | Missing ARIA, unused `transform` prop, no value input |
| `SnappableSlider.tsx` | ~140 | No keyboard support, 90+ global listeners, no reset, no scroll |
| `styles.css` | ~200 | Global, no custom properties, not responsive, oversized slider |

Zero tests exist. Test infra (bun runner, happy-dom) is configured but no test script or test files.

---

## Phase 0: Test Infrastructure Setup

_Quick setup so all subsequent phases include tests._

- [ ] Add `"test": "bun test"` to `package.json` scripts
- [ ] Verify `bun test` runs (even with 0 tests)
- [ ] Add first test file: `src/audio/utils.test.ts`
  - `getSnappedValue` for each snap mode
  - `getUnitValue` for each unit
  - `dbFromLin` / `linFromDb` round-trip

---

## Phase 1: Accessibility & Core Interactions

_Make sliders compliant with WAI-ARIA Slider Pattern and add DAW-standard interactions._

### 1.1 Keyboard support for SnappableSlider

- Handle `ArrowRight`/`ArrowUp` → increment value by step
- Handle `ArrowLeft`/`ArrowDown` → decrement value by step
- Handle `Home` → set to `min`, `End` → set to `max`
- Handle `PageUp`/`PageDown` → 10× step
- Step size: use `ControlDef.step` (new property, see 1.5) or fall back to `(max - min) / 100`
- When snap is active, step to next/previous snap point
- Respect skew curve when computing steps

### 1.2 ARIA attributes

- Add `aria-labelledby` on SnappableSlider, linked to the label in AudioControl via id
- Add `aria-valuetext` using a new `formatValueText(value, key, snap, tempo)` utility
  - Examples: "440 Hz", "-6.0 dB", "2 bars", "1 beat"
  - Utility is separately testable
- `aria-valuenow`, `aria-valuemin`, `aria-valuemax` already present — verify correctness

### 1.3 Focus styles

- Add `outline` on `.snappable-slider:focus-visible`
- Add focus-visible styles for `button`, `select`, `input[type="checkbox"]`

### 1.4 Double-click to reset

- On `onDoubleClick`, reset slider to its `defaultValue`
- Requires passing `defaultValue` through AudioControl → SnappableSlider

### 1.5 Scroll-wheel support

- On `wheel` event, adjust value by ±step
- Shift+wheel for fine adjustment (÷10 step)
- Prevent page scroll while interacting with slider

### 1.6 Add `step` to ControlDef

- Add explicit `step` property to `ControlDef` interface
- Domain-appropriate steps: 1 dB for gain, 100 cents for detune, 0.01 for playbackRate, etc.
- Used by keyboard and scroll-wheel handlers

### 1.7 Reduce global event listeners

- Only register `mousemove`/`mouseup`/`touchmove`/`touchend` when drag is active (on mousedown)
- Remove listeners on mouseup
- Keep `keydown`/`keyup` for Alt key on the slider element only (via onKeyDown/onKeyUp props)

### 1.8 Tests

- Unit test: `formatValueText` for each key/unit combo
- Component test: keyboard interaction (arrow keys, Home/End, PageUp/Down)
- Component test: double-click resets to default
- Component test: ARIA attributes are present with correct values
- Component test: scroll-wheel changes value

---

## Phase 2: UX Improvements

_Improve daily usability for audio development._

### 2.1 Direct value input

- Clicking the `<output>` element transforms it into `<input type="text">`
- Enter or blur: parse, clamp to [min, max], apply value, revert to output
- Escape: cancel edit, revert to output
- Format: accept raw number, apply unit conversion if needed

### 2.2 Playhead scrub

- During playback: dragging the playhead slider seeks the audio position (calls `node.playhead = x`)
- During stopped/paused: dragging sets the start position
- Visual indicator: playhead fill animates during playback

### 2.3 Visual state feedback on transport

- Highlight the active transport button (e.g., border/background color change)
- Disable buttons that can't be used in current state:
  - `Start` disabled when playing
  - `Stop`/`Pause` disabled when stopped/initial
  - `Resume` disabled when not paused
- Use `aria-disabled` for semantics

### 2.4 Control grouping

- Add `<fieldset>`/`<legend>` or heading-based sections: "Transport", "Loop", "Parameters"
- Visual separators between groups
- Collapse loop controls when loop is unchecked (CSS-only or minimal state)

### 2.5 Slider visual polish

- Make thumb more visible: solid color, drop shadow, hover effect
- Reduce slider height from 120px to 64px
- Show value tooltip near thumb on hover and during drag

### 2.6 Error handling UX

- Replace `alert("Load a sound file first")` with inline status message
- Show error state if AudioContext creation fails
- Show loading state while decoding audio

### 2.7 Remove dead code

- Remove or implement the unused `transform` prop in AudioControl
- Clean up any other dead props

### 2.8 Tests

- Component test: click output → type value → enter → value updates
- Component test: escape cancels edit
- Component test: transport button disabled states match node state
- Component test: control sections render with correct grouping

---

## Phase 3: Architecture Refactoring

_Break up App.tsx into composable pieces with type-safe state._

### 3.1 Extract control definitions

- Move `controlDefs`, `loopControlDefs`, `paramDefs` to `src/audio/controlDefs.ts`
- Define `type ControlKey = "playhead" | "offset" | "duration" | ...` union
- Type state as `Record<ControlKey, number>` instead of `Record<string, number>`
- Include `step` and `defaultValue` in defs

### 3.2 Extract state hook: `useClipControls`

- Lives in `src/hooks/useClipControls.ts`
- Uses `useReducer` for complex multi-field state
- Actions: `setValue(key, value)`, `setSnap(key, snap)`, `setEnabled(key, on)`, `resetAll()`
- Includes localStorage persistence
- Returns `{ values, snaps, enabled, setValue, setSnap, setEnabled, resetAll }`

### 3.3 Extract audio hook: `useClipNode`

- Lives in `src/hooks/useClipNode.ts`
- Manages AudioContext lifecycle, ClipNode creation/disposal
- Exposes `{ start, stop, pause, resume, dispose, loadSound, nodeState, frameData }`
- Takes `values` and `enabled` from `useClipControls` as parameters
- Owns the RAF loop for frame data

### 3.4 Decompose App.tsx rendering

- `<TransportButtons>` — receives `{ nodeState, onStart, onStop, onPause, onResume, onDispose, onLog, onLoadSound }`
- `<DisplayPanel>` — receives `{ nodeState, currentTime, currentFrame, timesLooped, latency, timeTaken }`
- `<ControlSection>` — receives defs array + state + handlers, renders AudioControls with section heading
- App.tsx becomes ~80 lines composing these + hooks

### 3.5 Tests

- Unit test: `useClipControls` reducer — setValue, setSnap, setEnabled, resetAll
- Unit test: control key type safety (compile-time check)
- Component test: TransportButtons renders correct disabled states

---

## Phase 4: Styling & Responsiveness

_Modernize CSS and support mobile._

### 4.1 CSS custom properties

Define at `:root`:
```css
--color-bg: #404040;
--color-surface: #505050;
--color-text: #fff;
--color-accent: #7aa2f7;
--color-border: #666;
--slider-height: 64px;
--slider-thumb-width: 24px;
--control-gap: 4px;
--font-size-sm: 0.875rem;
```

Replace all hardcoded values throughout.

### 4.2 Responsive layout

- `@media (max-width: 768px)`: AudioControl grid stacks to 2 columns (label+slider, then output+selects)
- `@media (max-width: 480px)`: full vertical stack
- Buttons: smaller on mobile, 2-column grid instead of flex-wrap
- Slider height: 48px on mobile

### 4.3 Component-scoped styles

- Keep single `styles.css` (not CSS Modules — overkill for this project size)
- Use BEM-like naming: `.audio-control__label`, `.snappable-slider__thumb`
- Prefix all classes to avoid collision if embedded

### 4.4 Tests

- Run `bun run screenshot:catalog` to regenerate visual catalog (per AGENTS.md)
- Manual visual check on mobile viewport

---

## Implementation Order

| # | Phase | Why This Order |
|---|-------|---------------|
| 1 | Phase 0 | 5-minute setup, unblocks testing in all subsequent phases |
| 2 | Phase 1 | Accessibility is critical; keyboard/scroll/reset are core interactions |
| 3 | Phase 2 | UX improvements are user-facing and motivate architecture cleanup |
| 4 | Phase 3 | Refactor once behavior is stable; tests from P1/P2 act as safety net |
| 5 | Phase 4 | Polish styling last when structure and behavior are finalized |

Each phase includes its own tests. Tests are written alongside code, not as a separate phase.

---

## Files Created/Modified

| File | Action | Phase |
|------|--------|-------|
| `package.json` | Add test script | 0 |
| `src/audio/utils.test.ts` | New: utility tests | 0 |
| `src/components/SnappableSlider.tsx` | Keyboard, ARIA, scroll, reset, listeners | 1 |
| `src/components/AudioControl.tsx` | ARIA, default value passthrough, remove dead props | 1, 2 |
| `src/audio/formatValueText.ts` | New: ARIA value formatting utility | 1 |
| `src/audio/formatValueText.test.ts` | New: tests | 1 |
| `src/components/SnappableSlider.test.tsx` | New: component tests | 1 |
| `src/components/AudioControl.test.tsx` | New: component tests | 1, 2 |
| `src/styles.css` | Focus styles, slider sizing, grouping, responsive | 1, 2, 4 |
| `src/components/TransportButtons.tsx` | New: extracted component | 2, 3 |
| `src/components/DisplayPanel.tsx` | New: extracted component | 2, 3 |
| `src/components/ControlSection.tsx` | New: section container | 2, 3 |
| `src/audio/controlDefs.ts` | New: extracted control definitions | 3 |
| `src/hooks/useClipControls.ts` | New: state management hook | 3 |
| `src/hooks/useClipNode.ts` | New: audio lifecycle hook | 3 |
| `src/App.tsx` | Decomposed to ~80 lines | 3 |
| `src/hooks/useClipControls.test.ts` | New: hook tests | 3 |
