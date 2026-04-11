# Task 7: Enable range replacement in the processor buffer for streaming

## Goal

Make it possible to replace arbitrary sample ranges inside the AudioWorklet processor buffer so the processor can play audio that arrives incrementally instead of requiring the full sound up front.

This should support two modes with the same underlying mechanism:

1. Full-buffer playback, where the host provides the entire sound at once.
2. Streaming-style playback, where the host appends or overwrites chunks ahead of the playhead.

Important constraint for this task:

- We will know the final sample length from metadata before playback starts.
- We may not have downloaded or decoded the full file yet.
- The processor should therefore start from a pre-created full-length silent buffer and play silence for regions that exist logically but have not been decoded and written yet.

## Current State

The current design only supports whole-buffer replacement:

- `ClipNode.buffer` sends a single `{ type: "buffer", data: Float32Array[] }` message.
- `handleProcessorMessage()` replaces `properties.buffer` wholesale.
- `processBlock()` assumes `properties.buffer[0].length` is the authoritative, stable source length for the whole render.
- There is no concept of:
  - partially available audio
  - pending writes
  - end-of-stream
  - underrun / buffering
  - backpressure / low-water notifications

That works for decoded files loaded fully into memory, but not for a source where:

- the final timeline length is known in advance
- decoded PCM arrives progressively
- playback should continue through not-yet-decoded regions as silence until the decoder catches up

## Design Direction

Use an absolute-addressable stream buffer inside the processor rather than a ring buffer as the first implementation.

Why this direction:

- The user requirement is to replace ranges of values, not only append.
- Absolute offsets make arbitrary overwrite semantics simple and deterministic.
- It keeps the existing playhead model mostly intact.
- It allows streaming by appending chunks at increasing offsets.
- It matches the known-final-length model: preallocate the whole timeline once, then fill decoded regions in place.

Do not start with a circular/ring buffer unless memory pressure or truly unbounded streams become a real constraint. A ring buffer is better for infinite live input, but it complicates seeking, loop math, and arbitrary replacement. For file-style streaming, an absolute timeline buffer is the simpler and safer first step.

Because final length is known up front, the default path should be preallocation, not incremental capacity growth. Dynamic growth should remain only as a fallback for cases where metadata is missing or wrong.

## Proposed Architecture

### 1. Introduce explicit stream-buffer state in the processor

Add a new internal structure alongside or inside `ClipProcessorOptions` state, for example:

```ts
interface StreamBufferState {
  channels: Float32Array[];
  allocatedLength: number;
  committedLength: number;
  totalLength: number | null;
  streamEnded: boolean;
  streaming: boolean;
  writtenSpans: Array<{ startSample: number; endSample: number }>;
}
```

Meaning:

- `channels`: the mutable sample storage the processor reads from.
- `allocatedLength`: the current capacity.
- `committedLength`: the highest contiguous sample index that is decoded and safe to read from sample `0` onward.
- `totalLength`: known final length from metadata. In this task it should normally be known before playback starts.
- `streamEnded`: no more chunks will arrive.
- `streaming`: tells playback logic to tolerate incomplete future data instead of treating the current buffer length as final.
- `writtenSpans`: decoded regions that have been written into the silent backing buffer.

Important detail: `committedLength` should track contiguous readable data, not merely the highest written index. If a future range is written before an earlier gap, playback must not read through the gap.

Also important: this model separates three states for any sample range:

- allocated but not decoded yet: stored as silence
- decoded and written: stored as actual PCM
- outside final length: invalid

### 2. Replace direct mutation with queued write operations

Do not mutate the active read buffer directly from `port.onmessage`. Instead, queue writes and apply them at the start of each `process()` block.

Add an internal write-op shape like:

```ts
interface BufferRangeWrite {
  startSample: number;
  channelData: Float32Array[];
  totalLength?: number | null;
  streamEnded?: boolean;
}
```

Why queue writes:

- It makes buffer updates deterministic at block boundaries.
- It avoids partial mutation while `processBlock()` is reading.
- It gives one place to update capacity, committed length, and stream state.

### 3. Expand the processor message protocol

Keep the existing whole-buffer message as a convenience wrapper, but add range-based messages.

Suggested message set:

- `bufferInit`
  - allocates or resets the internal stream buffer
  - data: `{ channels: number; totalLength: number; streaming?: boolean; fillValue?: 0 }`
- `bufferRange`
  - writes samples starting at an absolute offset
  - data: `{ startSample: number; channelData: Float32Array[]; totalLength?: number | null; streamEnded?: boolean }`
- `bufferEnd`
  - marks no more chunks will arrive
  - data: `{ totalLength?: number }`
- `bufferReset`
  - clears pending writes and stored samples

Compatibility path:

- Existing `buffer` message can be treated as `bufferInit + bufferRange(start=0) + bufferEnd(totalLength=data[0].length)`.

For this project’s expected streaming case, `bufferInit` should happen before playback starts and should pre-create a full-length zero-filled backing buffer based on metadata.

### 4. Teach playback to distinguish unavailable data from finished data

`processBlock()` currently uses `buffer[0].length` as both capacity and available content. That needs to split into three concepts:

- allocated capacity
- committed readable length
- final total length, if known

In this task, the processor will usually have full final capacity from the start, but only part of that capacity will contain decoded audio.

Playback rules for the streaming path:

- If indexes are fully inside committed data, read normally.
- If the playhead reaches allocated but not-yet-decoded territory, output silence for those samples and keep the processor alive.
- If the playhead reaches or exceeds final available content and `streamEnded === true`, transition to `Ended`.
- If only part of a block has been decoded, render the decoded prefix or spans and leave the undecoded remainder as silence.

This creates a decode-lag behavior instead of treating missing future PCM as end-of-file. The backing buffer already exists at full length; the question is whether each sample range has been filled with decoded content yet.

### 5. Add host-visible buffering signals

Streaming is easier if the host knows when to send more audio. The processor already posts per-block frame data, but a dedicated low-water signal is more direct.

Add optional outbound messages such as:

- `bufferLowWater`
  - fired when buffered audio ahead of the playhead drops below a threshold
- `bufferUnderrun`
  - fired when playback wants samples that have not been committed yet
- `bufferCommitted`
  - optional ack for debugging and tests

Initial implementation can keep this simple:

- compute `bufferedAheadSamples = committedLength - floor(playhead)`
- emit `bufferLowWater` once when below a configured threshold
- clear the low-water state after more data is committed

Given the new constraint, it is also reasonable to emit a more specific signal such as `decodeLag` or `bufferUnderrun` when playback enters a not-yet-decoded span of the preallocated buffer.

### 6. Limit scope for looping and seeking in the first pass

Looping over incomplete data has edge cases. The first implementation should define strict, simple rules:

- Streaming mode does not support loop ranges beyond `committedLength`.
- If looping is enabled while data is incomplete, clamp effective loop end to committed data.
- If that becomes too awkward, explicitly disable loop mode for streaming buffers in v1.

Likewise for seeking:

- Seeking into committed data is allowed.
- Seeking beyond committed data is allowed only if the processor treats it as buffered silence while waiting for future chunks.

The plan should choose one rule and encode it in tests before implementation begins. My recommendation is:

- allow seek beyond committed data
- render silence until decoded PCM arrives
- disable looping for streaming mode in the first version

## Implementation Steps

### Step 1: Add stream-oriented types and message contracts

Files:

- `src/audio/types.ts`
- `src/audio/ClipNode.ts`

Work:

- Add typed message definitions for `bufferInit`, `bufferRange`, `bufferEnd`, and `bufferReset`.
- Make `bufferInit.totalLength` required for the streaming path.
- Add outbound message types for low-water / underrun if included.
- Add new `ClipNode` methods:
  - `initializeBuffer(totalLength, channels, options?)`
  - `replaceBufferRange(startSample, channelData, options?)`
  - `appendBufferRange(channelData, options?)`
  - `finalizeBuffer(totalLength?)`
- Preserve the existing `buffer` setter as a convenience wrapper over the new API.

Host-side note:

- `appendBufferRange()` should maintain a host-side write cursor for the common sequential-decode case.
- `replaceBufferRange()` should remain available for correction or out-of-order writes.

### Step 2: Add processor-side stream buffer state and write queue

Files:

- `src/audio/processor.ts`
- `src/audio/processor-kernel.ts`

Work:

- Add write-queue state to the worklet instance.
- Route range messages into the queue from `port.onmessage`.
- Add a pure helper in `processor-kernel.ts` that applies queued writes to buffer state.
- Preallocate the full silent buffer from metadata during `bufferInit`.
- Keep dynamic growth only as a guarded fallback if metadata turns out to be wrong.
- Track contiguous committed length correctly.

The write-application helper should update `writtenSpans` and recompute `committedLength` from the start of the timeline.

This helper should stay pure and heavily unit-tested, because it will carry most of the streaming correctness risk.

### Step 3: Split “buffer capacity” from “readable samples” in `processBlock()`

Files:

- `src/audio/processor-kernel.ts`

Work:

- Stop treating `buffer[0].length` as the only source-length value.
- Make index generation and end detection depend on committed/final length instead.
- Render silence for allocated-but-undecoded regions while the stream is still open.
- End only when playback has passed the final committed content and the stream is closed.
- Keep the current whole-buffer behavior unchanged when `streaming === false`.

Implementation detail:

- Since the underlying storage is pre-zeroed, the processor can safely read from the full allocated buffer.
- It still needs decoded-span tracking so it can distinguish intentional silence from not-yet-decoded content for end-of-stream and diagnostics.

### Step 4: Add a high-level streaming helper in the hook layer

Files:

- `src/hooks/useClipNode.ts`

Work:

- Add a minimal helper path that can feed chunks into the node without recreating it.
- Add a minimal helper path that initializes the full silent buffer from metadata before decode starts.
- Keep full-file loading unchanged.
- Do not solve compressed-audio chunk decoding here unless needed.

Important limitation to note in code and task comments:

- This task enables PCM chunk streaming into the processor.
- Metadata can provide duration / expected sample count before full payload arrival.
- Streaming decode for compressed formats is a separate problem unless a chunk-capable decoder is introduced.
- `decodeAudioData()` still expects a complete decodable payload, so true progressive playback requires either partial PCM delivery from another decoder path or a format/decoder that can emit decoded leading segments before the full download completes.

### Step 5: Add end-to-end-style regression coverage

Files:

- `src/audio/processor-kernel.test.ts`
- `src/audio/sound-output.test.ts`
- `src/audio/ClipNode.ts` tests if needed

Minimum test matrix:

1. `bufferRange` writes samples into an existing buffer at the correct offset.
2. Multiple writes that extend contiguously advance `committedLength`.
3. Writes that leave a gap do not advance `committedLength` past the gap.
4. Playback renders available samples and then silence while waiting for future chunks.
5. Appending chunks over successive blocks produces continuous audible output once data is committed.
6. Stream closes and playback ends only after committed data is exhausted.
7. Replacing a future range before it is played changes audible output as expected.
8. Seeking into uncommitted territory yields silence, then resumes audio once the range is written.
9. Existing whole-buffer playback tests still pass through the compatibility wrapper.
10. Preallocated but undecoded tail remains silent even though final length is already known.
11. Processor does not end early merely because playback enters undecoded space inside the known final timeline.

One of the `sound-output` tests should simulate real streaming behavior:

- initialize a full-length silent buffer from metadata
- write only a short decoded prefix
- start playback
- process a few blocks
- append more data ahead of the playhead
- verify playback continues without replacing the whole processor buffer
- verify undecoded regions output silence until replaced with decoded PCM

## Recommended Constraints For V1

Keep the first version intentionally narrow:

- PCM `Float32Array[]` chunks only
- same channel count for the lifetime of a stream
- no shrinking / trimming in the first pass
- no streaming loops in v1
- apply writes only at block boundaries
- total length known up front for the primary implementation path

These constraints are reasonable and reduce failure modes while still delivering the main capability.

## Open Questions

These should be answered before implementation starts:

1. Do we need arbitrary overwrite semantics immediately, or is append-plus-occasional-fixup enough?
2. Should gaps be legal, or should the API require strictly contiguous append in streaming mode?
3. Do we want explicit backpressure messages, or is existing frame/playhead reporting enough for the host?
4. Is preserving loop support during streaming important for the first release?
5. Do we want to preallocate a target length when known, or grow dynamically in all cases?

My recommendation:

1. Support arbitrary overwrite, but optimize for append.
2. Allow gaps internally, but treat them as silence inside the preallocated timeline.
3. Add `bufferLowWater` in v1.
4. Defer streaming loop support.
5. Preallocate the full silent timeline from metadata by default; only grow as a fallback.

## Files Likely To Change

- `src/audio/types.ts`
- `src/audio/ClipNode.ts`
- `src/audio/processor.ts`
- `src/audio/processor-kernel.ts`
- `src/audio/processor-kernel.test.ts`
- `src/audio/sound-output.test.ts`
- `src/hooks/useClipNode.ts`

## Success Criteria

The task is complete when all of the following are true:

- The processor accepts partial buffer writes by absolute sample offset.
- Existing full-buffer playback still works through a compatibility path.
- Playback can start before the full sound has arrived.
- Known-but-not-yet-decoded regions inside the preallocated buffer produce silence, not premature end-of-playback.
- Closing the stream ends playback only after committed audio has been consumed.
- Regression tests cover append, overwrite, gap handling, underrun, and normal non-streaming playback.
- Type checking, linting, and tests all pass.
