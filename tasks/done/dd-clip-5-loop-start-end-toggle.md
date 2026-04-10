# Task 5: Add Toggle Switches to loopStart and loopEnd

## Goal
Give `loopStart` and `loopEnd` a toggle switch just like all the other parameters (`loopCrossfade`, `gain`, `pan`, `playbackRate`, etc.).

When toggled off, `loopStart` resets to `0` and `loopEnd` resets to the full buffer length — effectively making the loop span the entire buffer, as if the parameters were not set.

## Current State
- `loopCrossfade` already has `hasToggle: true` and the full pipeline works for it.
- `loopStart` and `loopEnd` have no toggle support at any layer.
- The toggle pipeline has 5 layers: **controlDefs → UI state → useClipNode → ClipNode → processor-kernel**.

## Implementation Steps

### Step 1: Add `enableLoopStart` and `enableLoopEnd` to `ClipProcessorOptions` (types.ts)
- Add `enableLoopStart?: boolean` and `enableLoopEnd?: boolean` to the `ClipProcessorOptions` interface.
- Add `"toggleLoopStart"` and `"toggleLoopEnd"` to the `ClipProcessorToggleMessageType` union type.

### Step 2: Add defaults in `getProperties()` (processor-kernel.ts)
- In the `getProperties` function, add `enableLoopStart` and `enableLoopEnd` with defaults (defaulting to `true` — matching how other toggles work).
- Add them to the destructuring and the returned object.

### Step 3: Handle toggle messages in `handleProcessorMessage()` (processor-kernel.ts)
- Add `case "toggleLoopStart"` and `case "toggleLoopEnd"` message handlers, following the existing pattern:
  ```typescript
  case "toggleLoopStart":
      properties.enableLoopStart = (data as boolean | undefined) ?? !properties.enableLoopStart;
      return [];
  case "toggleLoopEnd":
      properties.enableLoopEnd = (data as boolean | undefined) ?? !properties.enableLoopEnd;
      return [];
  ```

### Step 4: Apply enable flags in `processBlock()` (processor-kernel.ts)
- When `enableLoopStart` is `false`, use `0` for `loopStartSamples` instead of the user value.
- When `enableLoopEnd` is `false`, use `sourceLength` for `loopEndSamples` instead of the user value.
- This is the simplest and cleanest approach — the stored loopStart/loopEnd values remain preserved, they just aren't applied when toggled off.

### Step 5: Add toggle methods to `ClipNode` (ClipNode.ts)
- Add `toggleLoopStart(value = true)` and `toggleLoopEnd(value = true)` methods, following the existing pattern:
  ```typescript
  toggleLoopStart(value = true) {
      this.port.postMessage({ type: "toggleLoopStart", data: value });
  }
  toggleLoopEnd(value = true) {
      this.port.postMessage({ type: "toggleLoopEnd", data: value });
  }
  ```

### Step 6: Add toggle handling in `applyToggle()` (useClipNode.ts)
- Add cases for `"loopStart"` and `"loopEnd"` in the `applyToggle` switch:
  ```typescript
  case "loopStart":
      node.toggleLoopStart(on);
      break;
  case "loopEnd":
      node.toggleLoopEnd(on);
      break;
  ```

### Step 7: Add `hasToggle: true` to control definitions (controlDefs.ts)
- Add `hasToggle: true` to the `loopStart` and `loopEnd` entries in `loopControlDefs`.

### Step 8: Update tests
- **processor-kernel.test.ts**: Add tests for `toggleLoopStart` / `toggleLoopEnd` message handling and verify that `processBlock` respects the enable flags.
- **controlDefs.test.ts**: If there are existing tests validating control defs, update them to reflect the new toggle.
- Add unit tests to verify that toggling off loopStart resets to 0 and toggling off loopEnd resets to buffer length.

## Files to Modify
1. `src/audio/types.ts` — Add `enableLoopStart`, `enableLoopEnd`, toggle message types
2. `src/audio/processor-kernel.ts` — `getProperties()`, `handleProcessorMessage()`, `processBlock()`
3. `src/audio/ClipNode.ts` — Add `toggleLoopStart()`, `toggleLoopEnd()` methods
4. `src/hooks/useClipNode.ts` — Add cases in `applyToggle()`
5. `src/audio/controlDefs.ts` — Add `hasToggle: true` to loopStart/loopEnd
6. `src/audio/processor-kernel.test.ts` — New toggle tests

## Design Decisions
- **Toggle-off behavior**: When toggled off, loopStart → 0, loopEnd → buffer length. This means the loop covers the full buffer, which is the natural "disabled" state.
- **Value preservation**: The actual slider values are preserved in UI state. Toggling back on restores the previous values without loss.
- **Consistency**: Follows the exact same pattern as all 9 existing toggles. No new abstractions needed.
