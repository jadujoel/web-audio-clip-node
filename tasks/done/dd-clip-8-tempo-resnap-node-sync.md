# Task 8: Resnap tempo-based controls and sync them to the node on tempo change

## Goal

When the BPM changes, every control using a tempo-derived snap (`beat`, `bar`, `8th`, `16th`) should:

- keep the same musical count the user selected
- update its stored seconds value to match the new tempo
- immediately send the recalculated value to the live `ClipNode`

Example: a control set to `2 beats` at `120 BPM` should move from `1.0s` to `2.0s` when tempo changes to `60 BPM`.

## Current behavior

Tempo currently only affects UI-derived snap points and labels.

- [src/store/clipStore.ts](src/store/clipStore.ts) `setTempo()` only writes the new BPM into store state.
- [src/components/AudioControl.tsx](src/components/AudioControl.tsx) uses `tempo` only while the user is actively dragging/editing a control.
- [src/App.tsx](src/App.tsx) sends values to the node only through `handleValueChange()`.
- [src/hooks/useClipNode.ts](src/hooks/useClipNode.ts) applies values when asked, but there is no batch resync triggered by a tempo update.

That leaves the UI in a mixed state after tempo edits: snap labels/ticks reflect the new BPM, while the underlying control values and node parameters remain based on the old BPM.

## Recommended behavior

Tempo edits should preserve the snapped musical amount, not preserve raw seconds.

Why:

- The UI already presents snapped values as counts like `bars`, `beats`, `8ths`, and `16ths` in [src/controls/formatValueText.ts](src/controls/formatValueText.ts).
- If tempo changes preserved raw seconds, a value displayed as `2 beats` could silently become `1 beat`, which is hard to justify from the user’s point of view.

## Plan

1. Add a shared tempo-resnap helper.

Create a small utility that:

- detects whether a snap mode is tempo-relative
- converts a seconds value into a snapped unit count using the old tempo
- converts that unit count back into seconds using the new tempo
- clamps the result to the effective min/max for that control

This should live alongside the existing snapping helpers in [src/audio/utils.ts](src/audio/utils.ts), so the same tempo math is shared by UI behavior and tempo-change behavior.

2. Centralize tempo-change handling in the app layer.

Replace the inline `controls.setTempo(v)` call in [src/App.tsx](src/App.tsx) with a dedicated `handleTempoChange()` flow that:

- reads the previous tempo before updating state
- iterates over all controls with tempo-relative snaps
- computes each control’s new seconds value from old tempo -> new tempo
- batches the updated control values into store state
- writes the new tempo into store state

The app layer is the right place because it already has access to:

- store state
- the live node API
- effective max values that depend on `audioDuration` and max-lock state

3. Keep store updates atomic.

Avoid updating tempo first and control values later in separate user-visible steps. The change should be applied as one logical operation so the rendered tick labels, output text, slider position, and stored values all move together.

If the current Zustand shape makes this awkward, add a store action such as `setTempoAndValues(tempo, values)` or `patchControls(...)` in [src/store/clipStore.ts](src/store/clipStore.ts) instead of chaining many single-key writes.

4. Sync recalculated values to the live node.

After recalculating tempo-dependent values, push only the changed keys into the node.

Implementation options:

- expose a small batch method from [src/hooks/useClipNode.ts](src/hooks/useClipNode.ts), or
- reuse the internal `applyValue()` logic in a loop through a new public helper

Requirements:

- no-op safely when no node exists yet
- still update store state even if audio has not been started yet
- avoid re-sending unchanged values

5. Respect control-specific bounds.

While recalculating values, clamp against the same effective range used by the UI:

- `mins[key]`
- `maxs[key]`
- `audioDuration` when `maxLocked[key]` is enabled

This matters for controls like `offset`, `duration`, `loopStart`, and `loopEnd`, where the valid max can shrink to the loaded file duration.

6. Add regression coverage before closing the task.

The implementation should include:

- utility tests in [src/audio/utils.test.ts](src/audio/utils.test.ts) for old-tempo -> new-tempo remapping
- a component/app-level regression test proving a tempo edit updates stored snapped values
- a node-sync regression test proving the recalculated values are sent to the live node

The most important scenario to cover is:

- set a tempo-snapped control to a known musical value
- change tempo
- assert the displayed value still represents the same musical count
- assert the raw seconds changed correctly
- assert the node received the new seconds value

## Suggested test cases

1. `beat` snap preserves beat count across tempo edits.
   `1.0s` at `120 BPM` becomes `2.0s` at `60 BPM` when the control represented `2 beats`.

2. `bar` snap preserves bar count across tempo edits.
   `2.0s` at `120 BPM` becomes `4.0s` at `60 BPM` when the control represented `1 bar`.

3. `8th` and `16th` snaps preserve subdivision count.

4. Values are clamped when the new tempo would push them past an effective max.

5. Changing tempo with no created node updates store/UI state without throwing.

6. Changing tempo only re-sends keys whose value actually changed.

## Files likely to change

- [src/App.tsx](src/App.tsx)
- [src/store/clipStore.ts](src/store/clipStore.ts)
- [src/hooks/useClipNode.ts](src/hooks/useClipNode.ts)
- [src/audio/utils.ts](src/audio/utils.ts)
- [src/audio/utils.test.ts](src/audio/utils.test.ts)
- one or more app/component regression tests, most likely in [src/components/AudioControl.test.tsx](src/components/AudioControl.test.tsx) or a new app-level test file under `src/`

## Acceptance criteria

- Editing BPM updates every tempo-snapped control to the equivalent musical value at the new tempo.
- The visible labels and slider positions stay consistent with the stored values.
- The live `ClipNode` receives the recalculated values immediately.
- Non-tempo-snapped controls are unchanged.
- Typecheck, lint, and tests pass after the implementation.