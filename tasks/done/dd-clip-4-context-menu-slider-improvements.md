# Task 4: Context Menu, Slider Improvements & Apple-Style Toggles

## Summary

Move snap/beat/bar settings into a right-click context menu to reduce clutter. Add configurable min/max for sliders with auto-max from audio file length. Fix snap regression on transport controls. Remove decimals from beat/bar display. Add enable/disable toggles for duration, offset, startDelay, stopDelay. Redesign all toggles as Apple-style switches.

---

## Step 1: Create `ContextMenu` component

**Files:** `src/components/ContextMenu.tsx`, `src/components/ContextMenu.test.tsx`

Create a custom context menu component that:
- Opens on right-click (contextmenu event) on the slider/control area
- Renders a positioned overlay with menu items
- Closes on click outside, Escape key, or item selection
- Supports sections with dividers
- Supports checkable items (for snap on/off) and radio groups (for snap mode)
- Supports sub-menus or inline number inputs (for min/max)
- Uses portal (createPortal) to render at document root to avoid overflow clipping
- Positions itself near cursor, adjusting if near viewport edges

**Menu structure per control:**
```
┌─────────────────────────┐
│ Snap                    │
│   ○ None                │
│   ○ Beat                │
│   ○ Bar                 │
│   ○ 8th                 │
│   ○ 16th                │
│   ○ Integer             │
│ ─────────────────────── │
│ Range                   │
│   Min: [___]            │
│   Max: [___]            │
│   ☐ Max = file length   │
└─────────────────────────┘
```

**Tests:** Rendering, open/close behavior, keyboard navigation (Escape), item selection callbacks, positioning logic.

---

## Step 2: Integrate context menu into `AudioControl`

**Files:** `src/components/AudioControl.tsx`, `src/components/AudioControl.test.tsx`

- Remove the `<select className="control-snap">` dropdown and its placeholder
- Remove `hasSnap` prop from `AudioControlProps` (no longer needed — all controls supporting snap get it via context menu)
- Add `onContextMenu` handler to the `.audio-control` div
- Track context menu open state and cursor position
- Render `<ContextMenu>` when open
- Pass snap mode, min/max values through context menu callbacks
- Add new props: `onMinChange`, `onMaxChange`, `audioDuration` (for "max = file length" option)
- Update grid layout from 5 columns to 4: `toggle | label | slider | output` (snap column removed)

**Tests:** Context menu opens on right-click, snap selection updates, min/max editing, file-length option.

---

## Step 3: Expose audio duration from `useClipNode`

**Files:** `src/hooks/useClipNode.ts`

- Add `audioDuration` state (default `null`)
- Set it when `decodeAudio` completes: `setAudioDuration(decoded.duration)`
- Return `audioDuration` from the hook
- When a new file is loaded, reset and update `audioDuration`

**Files:** `src/App.tsx`

- Pass `node.audioDuration` down through ControlSection to AudioControl
- When "max = file length" is checked in context menu, set that control's max to `audioDuration`

---

## Step 4: Add per-control min/max state to `useClipControls`

**Files:** `src/hooks/useClipControls.ts`

- Add `mins: Record<ControlKey, number>` and `maxs: Record<ControlKey, number>` state (initialized from controlDefs)
- Add `setMin(key, val)` and `setMax(key, val)` callbacks
- Add `maxLocked: Record<ControlKey, boolean>` for "max = file length" toggle per control
- When `maxLocked[key]` is true and audioDuration changes, auto-update `maxs[key]`
- Persist mins/maxs/maxLocked in localStorage alongside existing state

**Files:** `src/audio/controlDefs.ts`

- Add `mins` and `maxs` to `buildDefaults()` return value

---

## Step 5: Propagate min/max through `ControlSection`

**Files:** `src/components/ControlSection.tsx`, `src/components/ControlSection.test.tsx`

- Accept `mins`, `maxs`, `maxLocked`, `audioDuration`, `onMinChange`, `onMaxChange`, `onMaxLockedChange` props
- Pass them through to each `AudioControl`

**Files:** `src/App.tsx`

- Wire up the new min/max props from `useClipControls` and `audioDuration` from `useClipNode`

---

## Step 6: Fix slider snap regression

**Files:** `src/components/AudioControl.tsx`

The root cause: `enableSnap` on `SnappableSlider` is `!!preset`, so transport controls (no preset) never enable the slider's internal snapping.

Fix:
- When `snap !== "none"`, compute snap points from tempo and pass them to `SnappableSlider` as `snaps[]`
- Set `enableSnap={snap !== "none" || !!preset}`
- Compute tempo-based snap points: for "beat" → generate multiples of `60/tempo` within [min, max]; for "bar" → multiples of `(60/tempo)*4`; for "8th" → `60/tempo/8`; for "16th" → `60/tempo/16`; for "int" → integer values within range

**Helper function** (in `src/audio/utils.ts`):
```ts
export function generateSnapPoints(snap: string, tempo: number, min: number, max: number): number[]
```

**Tests:** `src/audio/utils.test.ts` — test snap point generation for each mode.

---

## Step 7: Remove decimals from beat/bar display

**Files:** `src/audio/formatValueText.ts`, `src/audio/formatValueText.test.ts`

When snap is beat/bar/8th/16th, displayed values should be integer-formatted:
- Change `${bars.toFixed(1)} bars` → `${Math.round(bars)} bars`
- Change `${beats.toFixed(1)} beats` → `${Math.round(beats)} beats`
- Add similar formatting for 8th and 16th snaps (currently falls through to `toPrecision(4)`)

---

## Step 8: Add enable/disable toggles for duration, offset, startDelay, stopDelay

**Files:** `src/audio/controlDefs.ts`

- Add `hasToggle: true` to the controlDefs entries for: `offset`, `duration`, `startDelay`, `stopDelay`

**Files:** `src/hooks/useClipNode.ts`

- Handle toggle for these keys in `applyToggle`:
  - When `offset` disabled → use default (0)
  - When `duration` disabled → use default (-1, full length)
  - When `startDelay` disabled → use default (0)
  - When `stopDelay` disabled → use default (0)
- On `start()`/`stop()`/`pause()`/`resume()`: check `enabled[key]` before applying the value

**Tests:** Toggle behavior for transport controls.

---

## Step 9: Apple-style toggle switch

**Files:** `src/styles.css`

Replace the checkbox styling with a pure-CSS toggle switch:
```css
.control-toggle {
  appearance: none;
  position: relative;
  width: 51px;
  height: 31px;
  border-radius: 31px;
  background: #555;
  transition: background 0.2s ease;
  cursor: pointer;
  outline: none;
  border: none;
}
.control-toggle:checked {
  background: #34c759;  /* Apple green */
}
.control-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.control-toggle:checked::after {
  transform: translateX(20px);
}
.control-toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

Remove the old 60x60 sizing. Update `.control-toggle-placeholder` to match new dimensions.

**Tests:** Visual consistency — component tests should verify toggle checked/unchecked states still work.

---

## Step 10: Update CSS grid layout

**Files:** `src/styles.css`

- AudioControl grid: change from `0.25fr 0.25fr 0.25fr 2fr 0.25fr` to `auto auto 2fr auto` (toggle | label | slider | output — snap column removed)
- Adjust responsive breakpoints accordingly
- Update `.control-snap` styles to be removed or repurposed for context menu
- Remove `.control-snap-placeholder`

---

## Step 11: Update all tests

**Files:** All `*.test.tsx` files

- Update AudioControl tests: remove snap dropdown tests, add context menu tests
- Update ControlSection tests: add min/max/maxLocked prop tests
- Update formatValueText tests: integer display for beat/bar
- Add utils tests for `generateSnapPoints`
- Verify toggle switch rendering for new toggleable controls

---

## Step 12: Final integration testing

- Run `bun test` to verify all unit tests pass
- Run type checking (`bun run typecheck` or `tsc --noEmit`)
- Run lint checks
- Manual smoke test: load audio, right-click controls, verify context menu, verify snap, verify toggles render as Apple switches

---

## Implementation Order & Rationale

1. **Step 9** (Apple toggle CSS) — standalone CSS change, no dependencies, immediately visible
2. **Step 7** (remove decimals) — standalone fix in formatValueText
3. **Step 6** (fix snap regression + generateSnapPoints) — standalone utility + AudioControl fix
4. **Step 8** (add toggles to transport controls) — requires only controlDefs + useClipNode changes
5. **Step 3** (expose audio duration) — needed before context menu min/max feature
6. **Step 4** (per-control min/max state) — needed before context menu
7. **Step 1** (ContextMenu component) — new component, no existing code changes
8. **Step 2** (integrate context menu into AudioControl) — ties steps 1,4,5,6 together
9. **Step 5** (propagate through ControlSection) — wiring
10. **Step 10** (CSS grid update) — layout cleanup after snap column removed
11. **Step 11** (update tests) — done incrementally with each step, final sweep here
12. **Step 12** (integration testing)
