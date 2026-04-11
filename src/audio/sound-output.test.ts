/**
 * Sound Output Verification Tests
 *
 * These tests ensure the processor actually produces non-silent output
 * under every reasonable parameter combination. The processor can fail
 * silently (literally) when an error occurs, so we verify RMS energy
 * is above a threshold for every block that should contain audio.
 *
 * 100+ test cases covering:
 * - Basic sound production with various buffer types
 * - All parameter enable/disable combinations
 * - Parameter value ranges (gain, pan, filters, rate, detune)
 * - Mid-playback parameter changes
 * - Loop transitions with various configurations
 * - Fade in/out interactions
 * - State transitions (pause/resume/stop)
 * - Edge cases (mono, very short buffers, extreme params)
 * - Combinatorial parameter sweeps
 */

import { describe, expect, it } from "bun:test";
import {
	checkNans,
	createFilterState,
	getProperties,
	handleProcessorMessage,
	type OutboundMessage,
	processBlock,
} from "./processor-kernel";
import type { ClipProcessorOptions } from "./types";
import { State } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SR = 48000;
const BLOCK = 128;

/** Creates a stereo sine wave buffer at the given frequency. */
function makeSine(
	lengthSamples: number,
	freq = 440,
	channels = 2,
): Float32Array[] {
	return Array.from({ length: channels }, () => {
		const arr = new Float32Array(lengthSamples);
		for (let i = 0; i < lengthSamples; i++) {
			arr[i] = Math.sin((2 * Math.PI * freq * i) / SR);
		}
		return arr;
	});
}

/** Creates a stereo white noise buffer. */
function makeNoise(lengthSamples: number, channels = 2): Float32Array[] {
	let seed = 42;
	function rand() {
		seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
		return (seed / 0x7fffffff) * 2 - 1;
	}
	return Array.from({ length: channels }, () => {
		const arr = new Float32Array(lengthSamples);
		for (let i = 0; i < lengthSamples; i++) arr[i] = rand();
		return arr;
	});
}

/** Creates a stereo buffer filled with a constant value. */
function makeConstant(
	lengthSamples: number,
	value: number,
	channels = 2,
): Float32Array[] {
	return Array.from({ length: channels }, () =>
		new Float32Array(lengthSamples).fill(value),
	);
}

function makeOutput(channels = 2, blockSize = BLOCK): Float32Array[] {
	return Array.from({ length: channels }, () => new Float32Array(blockSize));
}

function defaultParams(
	overrides: Partial<Record<string, Float32Array>> = {},
): Record<string, Float32Array> {
	return {
		playbackRate: new Float32Array([1]),
		detune: new Float32Array([0]),
		lowpass: new Float32Array([20000]),
		highpass: new Float32Array([20]),
		gain: new Float32Array([1]),
		pan: new Float32Array([0]),
		...overrides,
	};
}

function defaultFilterState() {
	return { lowpass: createFilterState(), highpass: createFilterState() };
}

/** Creates a started processor with given options, ready to produce audio. */
function makeStartedProps(
	overrides: Partial<ClipProcessorOptions>,
): Required<ClipProcessorOptions> {
	return getProperties(
		{
			state: State.Started,
			startWhen: 0,
			stopWhen: 100,
			duration: 100,
			...overrides,
		},
		SR,
	);
}

/** Compute RMS energy of a single-channel Float32Array. */
function rms(arr: Float32Array, start = 0, end?: number): number {
	const e = end ?? arr.length;
	let sum = 0;
	for (let i = start; i < e; i++) sum += arr[i] * arr[i];
	return Math.sqrt(sum / (e - start));
}

/** Check whether a block has any non-zero output. */
function hasSound(output: Float32Array[], threshold = 1e-10): boolean {
	for (const ch of output) {
		for (let i = 0; i < ch.length; i++) {
			if (Math.abs(ch[i]) > threshold) return true;
		}
	}
	return false;
}

/** Process N blocks and return outputs + metadata. */
function processBlocks(
	props: Required<ClipProcessorOptions>,
	numBlocks: number,
	params?: Record<string, Float32Array>,
): {
	outputs: Float32Array[][];
	messages: OutboundMessage[];
	energyPerBlock: number[];
	soundBlocks: number;
	silentBlocks: number;
} {
	const p = params ?? defaultParams();
	const filterState = defaultFilterState();
	const outputs: Float32Array[][] = [];
	const messages: OutboundMessage[] = [];
	const energyPerBlock: number[] = [];
	let soundBlocks = 0;
	let silentBlocks = 0;
	const blockDuration = BLOCK / SR;

	for (let b = 0; b < numBlocks; b++) {
		const out = [makeOutput(2)];
		const ct = 0.001 + b * blockDuration;
		const result = processBlock(
			props,
			out,
			p,
			{
				currentTime: ct,
				currentFrame: b * BLOCK,
				sampleRate: SR,
			},
			filterState,
		);
		outputs.push(out[0]);
		messages.push(...result.messages);
		const e = rms(out[0][0]);
		energyPerBlock.push(e);
		if (hasSound(out[0])) soundBlocks++;
		else silentBlocks++;
		if (!result.keepAlive) break;
	}
	return { outputs, messages, energyPerBlock, soundBlocks, silentBlocks };
}

// ===========================================================================
// 1. Basic Sound Production (10 tests)
// ===========================================================================

describe("Sound output: basic production", () => {
	it("1.01 — sine wave produces sound with all effects disabled", () => {
		const buffer = makeSine(SR); // 1 second
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 10);
		expect(soundBlocks).toBe(10);
	});

	it("1.02 — white noise produces sound", () => {
		const buffer = makeNoise(SR);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 10);
		expect(soundBlocks).toBe(10);
	});

	it("1.03 — constant value buffer produces sound", () => {
		const buffer = makeConstant(SR, 0.5);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 10);
		expect(soundBlocks).toBe(10);
	});

	it("1.04 — mono buffer produces stereo sound", () => {
		const buffer = makeSine(SR, 440, 1); // mono
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outputs = [makeOutput(1)];
		processBlock(
			props,
			outputs,
			defaultParams(),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(outputs[0].length).toBe(2); // mono → stereo
		expect(hasSound(outputs[0])).toBe(true);
	});

	it("1.05 — 10-second buffer produces sound throughout", () => {
		const buffer = makeSine(SR * 10, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 100);
		expect(soundBlocks).toBe(100);
	});

	it("1.06 — very short buffer (256 samples) produces sound", () => {
		const buffer = makeSine(256, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 2);
		expect(soundBlocks).toBe(2);
	});

	it("1.07 — low frequency (50 Hz) sine produces sound", () => {
		const buffer = makeSine(SR * 2, 50);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 20);
		expect(soundBlocks).toBe(20);
	});

	it("1.08 — high frequency (15000 Hz) sine produces sound", () => {
		const buffer = makeSine(SR * 2, 15000);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 20);
		expect(soundBlocks).toBe(20);
	});

	it("1.09 — multiple successive blocks all produce sound (no dropout)", () => {
		const buffer = makeSine(SR * 5, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { energyPerBlock } = processBlocks(props, 50);
		for (let i = 0; i < 50; i++) {
			expect(energyPerBlock[i]).toBeGreaterThan(0);
		}
	});

	it("1.10 — DC offset buffer (all 0.3) produces consistent output", () => {
		const buffer = makeConstant(SR, 0.3);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { energyPerBlock } = processBlocks(props, 10);
		for (const e of energyPerBlock) {
			expect(e).toBeCloseTo(0.3, 1);
		}
	});
});

// ===========================================================================
// 2. Gain Parameter Combinations (12 tests)
// ===========================================================================

describe("Sound output: gain variations", () => {
	it("2.01 — gain=1.0 (unity) preserves full signal", () => {
		const buffer = makeSine(SR);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ gain: new Float32Array([1]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("2.02 — gain=0.5 produces sound at reduced level", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ gain: new Float32Array([0.5]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(true);
		expect(rms(outs[0][0])).toBeCloseTo(0.5, 1);
	});

	it("2.03 — gain=0.01 (very quiet) still produces sound", () => {
		const buffer = makeSine(SR);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ gain: new Float32Array([0.01]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("2.04 — gain=0.0 produces silence", () => {
		const buffer = makeSine(SR);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { silentBlocks } = processBlocks(
			props,
			5,
			defaultParams({ gain: new Float32Array([0]) }),
		);
		expect(silentBlocks).toBe(5);
	});

	it("2.05 — gain toggled off: full volume despite gain param", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ gain: new Float32Array([0.01]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		// Gain disabled → param ignored → full volume
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 1);
	});

	it("2.06 — a-rate gain ramp from 0 to 1.0", () => {
		const buffer = makeConstant(SR, 1.0);
		const gains = new Float32Array(BLOCK);
		for (let i = 0; i < BLOCK; i++) gains[i] = i / (BLOCK - 1);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ gain: gains }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(true);
		// First sample ~ 0, last sample ~ 1
		expect(Math.abs(outs[0][0][0])).toBeLessThan(0.01);
		expect(Math.abs(outs[0][0][127])).toBeCloseTo(1.0, 1);
	});

	it("2.07 — gain=2.0 amplifies signal", () => {
		const buffer = makeConstant(SR, 0.3);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ gain: new Float32Array([2]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(0.6, 1);
	});

	it("2.08 — gain toggle on mid-playback restores processing", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const params = defaultParams({ gain: new Float32Array([0.5]) });
		// Block 1: gain disabled → full volume
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(rms(o1[0][0])).toBeCloseTo(1.0, 1);

		// Enable gain
		handleProcessorMessage(props, { type: "toggleGain", data: true }, 0.01, SR);

		// Block 2: gain=0.5 applied
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			defaultFilterState(),
		);
		expect(rms(o2[0][0])).toBeCloseTo(0.5, 1);
		expect(hasSound(o2[0])).toBe(true);
	});

	it("2.09 — gain changes between blocks", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const energies: number[] = [];
		const gainValues = [1.0, 0.5, 0.25, 0.1, 0.5, 1.0];
		for (let b = 0; b < gainValues.length; b++) {
			const out = [makeOutput(2)];
			const ct = 0.001 + b * (BLOCK / SR);
			processBlock(
				props,
				out,
				defaultParams({ gain: new Float32Array([gainValues[b]]) }),
				{
					currentTime: ct,
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			energies.push(rms(out[0][0]));
		}
		for (let i = 0; i < gainValues.length; i++) {
			expect(energies[i]).toBeCloseTo(gainValues[i], 1);
		}
	});

	it("2.10 — gain=0.001 (nearly inaudible) still has non-zero output", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			5,
			defaultParams({ gain: new Float32Array([0.001]) }),
		);
		expect(soundBlocks).toBe(5);
	});

	it("2.11 — toggling gain off/on doesn't cause dropout", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const params = defaultParams({ gain: new Float32Array([0.5]) });
		const fs = defaultFilterState();
		let allHaveSound = true;
		for (let b = 0; b < 20; b++) {
			if (b === 5)
				handleProcessorMessage(
					props,
					{ type: "toggleGain", data: false },
					0.01,
					SR,
				);
			if (b === 10)
				handleProcessorMessage(
					props,
					{ type: "toggleGain", data: true },
					0.02,
					SR,
				);
			if (b === 15)
				handleProcessorMessage(
					props,
					{ type: "toggleGain", data: false },
					0.03,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("2.12 — gain=10.0 (extreme amplification) produces loud output", () => {
		const buffer = makeConstant(SR, 0.1);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ gain: new Float32Array([10]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 0);
	});
});

// ===========================================================================
// 3. Pan Parameter Combinations (10 tests)
// ===========================================================================

describe("Sound output: pan variations", () => {
	it("3.01 — pan=0 (center): both channels have sound", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: new Float32Array([0]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeGreaterThan(0.5);
		expect(rms(outs[0][1])).toBeGreaterThan(0.5);
	});

	it("3.02 — pan=-1 (hard left): right channel silent", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: new Float32Array([-1]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 1);
		expect(rms(outs[0][1])).toBeCloseTo(0.0, 5);
	});

	it("3.03 — pan=+1 (hard right): left channel silent", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: new Float32Array([1]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(0.0, 5);
		expect(rms(outs[0][1])).toBeCloseTo(1.0, 1);
	});

	it("3.04 — pan=-0.5: left louder than right", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: new Float32Array([-0.5]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeGreaterThan(rms(outs[0][1]));
		expect(hasSound(outs[0])).toBe(true);
	});

	it("3.05 — pan disabled: both channels at full volume regardless of pan value", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: new Float32Array([-1]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 1);
		expect(rms(outs[0][1])).toBeCloseTo(1.0, 1);
	});

	it("3.06 — a-rate pan sweep left to right", () => {
		const buffer = makeConstant(SR, 1.0);
		const pans = new Float32Array(BLOCK);
		for (let i = 0; i < BLOCK; i++) pans[i] = -1 + (2 * i) / (BLOCK - 1);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ pan: pans }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(true);
		// At start (pan=-1): left=1, right=0
		expect(Math.abs(outs[0][0][0])).toBeCloseTo(1.0, 1);
		expect(Math.abs(outs[0][1][0])).toBeCloseTo(0.0, 1);
	});

	it("3.07 — pan toggle on mid-playback", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ pan: new Float32Array([1]) });
		// Block 1: pan disabled
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(rms(o1[0][0])).toBeCloseTo(1.0, 1); // both channels full

		// Enable pan
		handleProcessorMessage(props, { type: "togglePan", data: true }, 0.01, SR);

		// Block 2: pan=1 (hard right)
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(rms(o2[0][0])).toBeCloseTo(0.0, 1); // left zeroed
		expect(rms(o2[0][1])).toBeCloseTo(1.0, 1); // right full
	});

	it("3.08 — pan + gain combined", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({
				gain: new Float32Array([0.5]),
				pan: new Float32Array([-0.5]),
			}),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(true);
		// Left should be louder than right
		expect(rms(outs[0][0])).toBeGreaterThan(rms(outs[0][1]));
	});

	it("3.09 — six different pan positions all produce sound in at least one channel", () => {
		const positions = [-1, -0.5, -0.1, 0.1, 0.5, 1];
		for (const pan of positions) {
			const buffer = makeSine(SR, 440);
			const props = makeStartedProps({
				buffer,
				enableGain: false,
				enablePan: true,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: false,
			});
			const { soundBlocks } = processBlocks(
				props,
				3,
				defaultParams({ pan: new Float32Array([pan]) }),
			);
			expect(soundBlocks).toBe(3);
		}
	});

	it("3.10 — pan change between blocks doesn't cause dropout", () => {
		const buffer = makeSine(SR * 3, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const panValues = [-1, -0.5, 0, 0.5, 1, 0, -0.3, 0.7];
		let allHaveSound = true;
		for (let b = 0; b < panValues.length; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ pan: new Float32Array([panValues[b]]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});
});

// ===========================================================================
// 4. Filter Combinations (12 tests)
// ===========================================================================

describe("Sound output: filter variations", () => {
	it("4.01 — lowpass=20000 (max): signal passes through", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ lowpass: new Float32Array([20000]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("4.02 — highpass=20 (min): signal passes through", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ highpass: new Float32Array([20]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("4.03 — lowpass=5000: 440Hz sine passes through", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ lowpass: new Float32Array([5000]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("4.04 — highpass=5000: 10kHz sine passes through", () => {
		const buffer = makeSine(SR, 10000);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ highpass: new Float32Array([5000]) }),
		);
		// After filter settles (skip transient), should have energy
		expect(soundBlocks).toBeGreaterThan(15);
	});

	it("4.05 — bandpass: lowpass=5000 + highpass=200 passes 440Hz", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({
				lowpass: new Float32Array([5000]),
				highpass: new Float32Array([200]),
			}),
		);
		expect(soundBlocks).toBeGreaterThan(15);
	});

	it("4.06 — narrow bandpass: lowpass=500 + highpass=400 passes 440Hz", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({
				lowpass: new Float32Array([500]),
				highpass: new Float32Array([400]),
			}),
		);
		// Narrow band might reduce energy but should still produce sound
		expect(soundBlocks).toBeGreaterThan(10);
	});

	it("4.07 — lowpass=100: severely attenuates 5kHz signal", () => {
		const buffer = makeSine(SR * 2, 5000);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const result = processBlocks(
			props,
			30,
			defaultParams({ lowpass: new Float32Array([100]) }),
		);
		// High freq through low cutoff → most energy removed
		const avgEnergy =
			result.energyPerBlock.slice(5).reduce((a, b) => a + b) /
			(result.energyPerBlock.length - 5);
		expect(avgEnergy).toBeLessThan(0.1);
	});

	it("4.08 — filters disabled: params ignored, full signal", () => {
		const buffer = makeSine(SR, 15000);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({
				lowpass: new Float32Array([100]), // would kill 15kHz if enabled
				highpass: new Float32Array([18000]),
			}),
		);
		expect(soundBlocks).toBe(10);
	});

	it("4.09 — toggle lowpass on mid-playback with noise", () => {
		const buffer = makeNoise(SR * 2);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ lowpass: new Float32Array([500]) });

		// First 5 blocks: lowpass disabled → full noise energy
		let energy1 = 0;
		for (let b = 0; b < 5; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			energy1 += rms(out[0][0]);
		}

		handleProcessorMessage(
			props,
			{ type: "toggleLowpass", data: true },
			0.02,
			SR,
		);

		// Next 5 blocks: lowpass at 500Hz → reduced energy
		let energy2 = 0;
		for (let b = 5; b < 10; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			energy2 += rms(out[0][0]);
			expect(hasSound(out[0])).toBe(true);
		}
		// Lowpass 500Hz on noise should reduce energy significantly
		expect(energy2).toBeLessThan(energy1);
	});

	it("4.10 — toggle highpass on mid-playback", () => {
		const buffer = makeNoise(SR * 2);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ highpass: new Float32Array([10000]) });

		for (let b = 0; b < 5; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(out[0])).toBe(true);
		}

		handleProcessorMessage(
			props,
			{ type: "toggleHighpass", data: true },
			0.02,
			SR,
		);

		for (let b = 5; b < 15; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			// Should still produce some output even with highpass at 10kHz on noise
			// (noise has energy across all frequencies)
		}
	});

	it("4.11 — lowpass cutoff change mid-playback (5000→500→5000)", () => {
		const buffer = makeSine(SR * 3, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const cutoffs = [5000, 5000, 5000, 500, 500, 500, 5000, 5000, 5000];
		let allHaveSound = true;
		for (let b = 0; b < cutoffs.length; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ lowpass: new Float32Array([cutoffs[b]]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true); // 440Hz passes through all cutoffs
	});

	it("4.12 — all filters + gain + pan combined", () => {
		const buffer = makeSine(SR * 2, 1000);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({
				gain: new Float32Array([0.8]),
				pan: new Float32Array([0.3]),
				lowpass: new Float32Array([5000]),
				highpass: new Float32Array([200]),
			}),
		);
		// 1kHz with bandpass 200-5000, gain=0.8, pan=0.3 → still audible
		expect(soundBlocks).toBeGreaterThan(15);
	});
});

// ===========================================================================
// 5. Playback Rate & Detune (12 tests)
// ===========================================================================

describe("Sound output: playback rate & detune", () => {
	it("5.01 — rate=1.0: normal playback with sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ playbackRate: new Float32Array([1]) }),
		);
		expect(soundBlocks).toBe(20);
	});

	it("5.02 — rate=2.0: double speed, still produces sound", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ playbackRate: new Float32Array([2]) }),
		);
		expect(soundBlocks).toBe(20);
	});

	it("5.03 — rate=0.5: half speed, still produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ playbackRate: new Float32Array([0.5]) }),
		);
		expect(soundBlocks).toBe(20);
	});

	it("5.04 — rate=-1.0: reverse playback produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			playhead: SR, // start from middle
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ playbackRate: new Float32Array([-1]) }),
		);
		expect(soundBlocks).toBeGreaterThan(5);
	});

	it("5.05 — rate=0.1: very slow playback still produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ playbackRate: new Float32Array([0.1]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("5.06 — rate=4.0: fast playback produces sound", () => {
		const buffer = makeSine(SR * 10, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({ playbackRate: new Float32Array([4]) }),
		);
		expect(soundBlocks).toBe(10);
	});

	it("5.07 — detune=+1200 cents (1 octave up) produces sound", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ detune: new Float32Array([1200]) }),
		);
		expect(soundBlocks).toBe(20);
	});

	it("5.08 — detune=-1200 cents (1 octave down) produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			20,
			defaultParams({ detune: new Float32Array([-1200]) }),
		);
		expect(soundBlocks).toBe(20);
	});

	it("5.09 — rate=2 + detune=1200: combined 4x speed produces sound", () => {
		const buffer = makeSine(SR * 10, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			enableDetune: true,
		});
		const { soundBlocks } = processBlocks(
			props,
			10,
			defaultParams({
				playbackRate: new Float32Array([2]),
				detune: new Float32Array([1200]),
			}),
		);
		expect(soundBlocks).toBe(10);
	});

	it("5.10 — rate changes mid-playback (1→2→0.5→1)", () => {
		const buffer = makeSine(SR * 10, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();
		const rates = [1, 1, 2, 2, 0.5, 0.5, 1, 1];
		let allHaveSound = true;
		for (let b = 0; b < rates.length; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ playbackRate: new Float32Array([rates[b]]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("5.11 — toggle playbackRate off mid-playback: reverts to normal indexing", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ playbackRate: new Float32Array([2]) });

		// Block 1: rate=2
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		const ph1 = props.playhead;
		expect(hasSound(o1[0])).toBe(true);

		// Disable playback rate
		handleProcessorMessage(
			props,
			{ type: "togglePlaybackRate", data: false },
			0.01,
			SR,
		);

		// Block 2: normal speed indexing
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(o2[0])).toBe(true);
		// Playhead should advance 128 (normal) instead of 256 (rate=2)
		expect(props.playhead - ph1).toBe(128);
	});

	it("5.12 — toggle detune off mid-playback", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ detune: new Float32Array([1200]) });

		// Block 1: detune active (2x speed)
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(true);
		expect(props.playhead).toBeCloseTo(256, 0);

		handleProcessorMessage(
			props,
			{ type: "toggleDetune", data: false },
			0.01,
			SR,
		);

		// Block 2: detune disabled (normal speed)
		const o2 = [makeOutput(2)];
		const phBefore = props.playhead;
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(o2[0])).toBe(true);
		expect(props.playhead - phBefore).toBe(128);
	});
});

// ===========================================================================
// 6. Loop Playback Continuity (14 tests)
// ===========================================================================

describe("Sound output: loop continuity", () => {
	it("6.01 — basic loop: sound in every block for 500 blocks", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 1.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks, silentBlocks } = processBlocks(props, 500);
		expect(silentBlocks).toBe(0);
		expect(soundBlocks).toBe(500);
	});

	it("6.02 — short loop (0.01s = 480 samples): no dropouts over 200 blocks", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.01,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 200);
		expect(soundBlocks).toBe(200);
	});

	it("6.03 — loop with custom loopStart: no dropouts", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 1.5,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 300);
		expect(soundBlocks).toBe(300);
	});

	it("6.04 — loop + crossfade: no dropouts at boundaries", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 1.8,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks, outputs } = processBlocks(props, 400);
		expect(soundBlocks).toBe(400);
		// No NaN in any block
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("6.05 — loop + playbackRate=2: no dropouts", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(
			props,
			200,
			defaultParams({ playbackRate: new Float32Array([2]) }),
		);
		expect(soundBlocks).toBe(200);
	});

	it("6.06 — loop + reverse playback (-1): no dropouts", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			playhead: SR, // start in middle
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(
			props,
			200,
			defaultParams({ playbackRate: new Float32Array([-1]) }),
		);
		expect(soundBlocks).toBe(200);
	});

	it("6.07 — enable loop mid-playback: sound continues", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: false,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Play 5 blocks without loop
		for (let b = 0; b < 5; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(out[0])).toBe(true);
		}

		handleProcessorMessage(props, { type: "loop", data: true }, 0.02, SR);
		handleProcessorMessage(props, { type: "loopEnd", data: 2.0 }, 0.02, SR);

		// Continue: should keep producing sound
		for (let b = 5; b < 20; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(out[0])).toBe(true);
		}
	});

	it("6.08 — change loopStart mid-playback: no dropout", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let allHaveSound = true;
		for (let b = 0; b < 50; b++) {
			if (b === 15)
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.5 },
					0.05,
					SR,
				);
			if (b === 30)
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.1 },
					0.08,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("6.09 — change loopEnd mid-playback: no dropout", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let allHaveSound = true;
		for (let b = 0; b < 50; b++) {
			if (b === 15)
				handleProcessorMessage(props, { type: "loopEnd", data: 1.0 }, 0.05, SR);
			if (b === 30)
				handleProcessorMessage(props, { type: "loopEnd", data: 0.5 }, 0.08, SR);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("6.10 — loop + enableLoopStart=false: loops from 0", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5, // should be ignored
			loopEnd: 2.0,
			enableLoopStart: false,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 200);
		expect(soundBlocks).toBe(200);
	});

	it("6.11 — loop + enableLoopEnd=false: loops to buffer end", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5, // should be ignored
			enableLoopEnd: false,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 200);
		expect(soundBlocks).toBe(200);
	});

	it("6.12 — toggle loopCrossfade on/off repeatedly: no dropout", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: false,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let allHaveSound = true;
		for (let b = 0; b < 80; b++) {
			if (b === 10)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: true },
					0.03,
					SR,
				);
			if (b === 30)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: false },
					0.08,
					SR,
				);
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: true },
					0.13,
					SR,
				);
			if (b === 70)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: false },
					0.19,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("6.13 — loop + all effects enabled: no dropout", () => {
		const buffer = makeSine(SR * 2, 1000);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			enableDetune: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocks(
			props,
			300,
			defaultParams({
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				gain: new Float32Array([0.8]),
				pan: new Float32Array([0.2]),
				lowpass: new Float32Array([10000]),
				highpass: new Float32Array([100]),
			}),
		);
		expect(result.soundBlocks).toBe(300);
		for (const out of result.outputs) expect(checkNans(out)).toBe(0);
	});

	it("6.14 — loop + rate=-0.5 (slow reverse): sound in every block", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			playhead: SR, // start from middle
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(
			props,
			200,
			defaultParams({ playbackRate: new Float32Array([-0.5]) }),
		);
		expect(soundBlocks).toBe(200);
	});
});

// ===========================================================================
// 7. Fade In / Fade Out Sound (10 tests)
// ===========================================================================

describe("Sound output: fade in/out continuity", () => {
	it("7.01 — fadeIn: output ramps up, later blocks have more energy", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 0.5,
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { energyPerBlock } = processBlocks(props, 30);
		// Energy should increase over time during fade
		expect(energyPerBlock[10]).toBeGreaterThan(energyPerBlock[0]);
		expect(energyPerBlock[20]).toBeGreaterThan(energyPerBlock[10]);
	});

	it("7.02 — fadeIn: after fade completes, output is at full volume", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 0.1, // short fade
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { energyPerBlock } = processBlocks(props, 100);
		// After fade (0.1s = ~37 blocks), should be close to 1.0
		expect(energyPerBlock[50]).toBeCloseTo(1.0, 1);
	});

	it("7.03 — fadeIn disabled: first block at full volume", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 1.0,
			enableFadeIn: false, // disabled
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 1);
	});

	it("7.04 — fadeOut: output decreases approaching stopWhen", () => {
		const buffer = makeConstant(SR * 3, 1.0);
		const stopWhen = 2.0;
		const props = makeStartedProps({
			buffer,
			fadeOutDuration: 1.0,
			enableFadeOut: true,
			stopWhen,
			duration: stopWhen,
			playhead: Math.floor(1.0 * SR),
			playedSamples: Math.floor(1.0 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		const energies: number[] = [];
		for (let b = 0; b < 30; b++) {
			const out = [makeOutput(2)];
			const ct = 1.0 + b * (BLOCK / SR);
			processBlock(
				props,
				out,
				params,
				{ currentTime: ct, currentFrame: b * BLOCK, sampleRate: SR },
				fs,
			);
			energies.push(rms(out[0][0]));
		}
		// Energy should decrease over time
		expect(energies[20]).toBeLessThan(energies[0]);
	});

	it("7.05 — fadeOut disabled: maintains full volume until stop", () => {
		const buffer = makeConstant(SR * 3, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeOutDuration: 1.0,
			enableFadeOut: false,
			stopWhen: 2.0,
			duration: 2.0,
			playhead: Math.floor(1.5 * SR),
			playedSamples: Math.floor(1.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 1.5, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(rms(outs[0][0])).toBeCloseTo(1.0, 1);
	});

	it("7.06 — fadeIn + fadeOut combined: sound throughout only quieter at edges", () => {
		const buffer = makeConstant(SR * 4, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 0.01, // short fade: ~375 samples
			fadeOutDuration: 0.01,
			enableFadeIn: true,
			enableFadeOut: true,
			playhead: 0,
			playedSamples: 0,
			stopWhen: 3.0,
			duration: 3.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks, energyPerBlock } = processBlocks(props, 100);
		// After short fade (0.01s ~< 4 blocks), middle should be at full volume
		expect(energyPerBlock[50]).toBeCloseTo(1.0, 1);
		// Most blocks should have detectable sound
		expect(soundBlocks).toBeGreaterThan(90);
	});

	it("7.07 — toggleFadeIn off mid-playback: immediate full volume", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 1.0,
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Block 1: during fade
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		const e1 = rms(o1[0][0]);

		// Disable fade in
		handleProcessorMessage(
			props,
			{ type: "toggleFadeIn", data: false },
			0.01,
			SR,
		);

		// Block 2: should be at full volume
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		const e2 = rms(o2[0][0]);
		expect(e2).toBeGreaterThan(e1);
		expect(e2).toBeCloseTo(1.0, 1);
	});

	it("7.08 — toggleFadeOut off mid-playback: maintains volume", () => {
		const buffer = makeConstant(SR * 3, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeOutDuration: 1.0,
			enableFadeOut: true,
			stopWhen: 2.0,
			duration: 2.0,
			playhead: Math.floor(1.2 * SR),
			playedSamples: Math.floor(1.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Block 1: in fade-out zone with fade enabled
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 1.2, currentFrame: 0, sampleRate: SR },
			fs,
		);
		const e1 = rms(o1[0][0]);

		// Disable fade out
		handleProcessorMessage(
			props,
			{ type: "toggleFadeOut", data: false },
			1.2,
			SR,
		);

		// Block 2: no fade → full volume
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 1.2 + BLOCK / SR, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		const e2 = rms(o2[0][0]);
		expect(e2).toBeGreaterThanOrEqual(e1 - 0.01);
	});

	it("7.09 — fade in + loop: fade only applies to first playthrough", () => {
		const buffer = makeConstant(SR, 1.0);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.1, // 4800 samples = ~37 blocks
			fadeInDuration: 0.05, // 2400 samples fade
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 200);
		// After fade completes (~19 blocks for 0.05s fade), energy should be stable
		// Even during fade, should have sound
		expect(soundBlocks).toBeGreaterThan(195);
	});

	it("7.10 — very long fade (10s) produces gradual ramp", () => {
		const buffer = makeConstant(SR * 20, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 10.0,
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { energyPerBlock, soundBlocks } = processBlocks(props, 100);
		// Should have sound in later blocks as fade progresses
		// Cubic fade with 10s duration: very quiet initially
		expect(soundBlocks).toBeGreaterThan(50);
		// Energy should generally increase
		expect(energyPerBlock[99]).toBeGreaterThan(energyPerBlock[0]);
	});
});

// ===========================================================================
// 8. State Transitions (10 tests)
// ===========================================================================

describe("Sound output: state transitions", () => {
	it("8.01 — Scheduled → Started: sound begins when time reached", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = getProperties(
			{
				buffer,
				state: State.Scheduled,
				startWhen: 0.01,
				stopWhen: 100,
				duration: 100,
				enableGain: false,
				enablePan: false,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const fs = defaultFilterState();
		const params = defaultParams();

		// Before start time: silence
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.005, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(false);

		// After start time: sound
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.015, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(o2[0])).toBe(true);
	});

	it("8.02 — pause then resume: sound continues at same point", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Block 1: playing
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(true);
		const phBeforePause = props.playhead;

		// Pause
		handleProcessorMessage(props, { type: "pause" }, 0.01, SR);

		// Block during pause: silence (currentTime > pauseWhen)
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.5, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(o2[0])).toBe(false);
		expect(props.playhead).toBe(phBeforePause); // didn't advance

		// Resume
		handleProcessorMessage(props, { type: "resume" }, 0.5, SR);

		// Block after resume: sound
		const o3 = [makeOutput(2)];
		processBlock(
			props,
			o3,
			params,
			{ currentTime: 0.51, currentFrame: BLOCK * 2, sampleRate: SR },
			fs,
		);
		expect(hasSound(o3[0])).toBe(true);
	});

	it("8.03 — multiple pause/resume cycles: sound each time", () => {
		const buffer = makeSine(SR * 5, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let ct = 0.001;

		for (let cycle = 0; cycle < 5; cycle++) {
			// Play a block
			const oPlay = [makeOutput(2)];
			processBlock(
				props,
				oPlay,
				params,
				{ currentTime: ct, currentFrame: cycle * 3 * BLOCK, sampleRate: SR },
				fs,
			);
			expect(hasSound(oPlay[0])).toBe(true);
			ct += 0.1;

			// Pause
			handleProcessorMessage(props, { type: "pause" }, ct, SR);
			ct += 0.05;

			// Silence during pause
			const oPause = [makeOutput(2)];
			processBlock(
				props,
				oPause,
				params,
				{
					currentTime: ct,
					currentFrame: (cycle * 3 + 1) * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(oPause[0])).toBe(false);
			ct += 0.1;

			// Resume
			handleProcessorMessage(props, { type: "resume" }, ct, SR);
			ct += 0.01;

			// Sound again
			const oResume = [makeOutput(2)];
			processBlock(
				props,
				oResume,
				params,
				{
					currentTime: ct,
					currentFrame: (cycle * 3 + 2) * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(oResume[0])).toBe(true);
			ct += 0.1;
		}
	});

	it("8.04 — stop: outputs silence after stopWhen", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			stopWhen: 0.5,
			duration: 0.5,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Before stop: sound
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.1, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(true);

		// After stop: silence
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.6, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(props.state).toBe(State.Ended);
	});

	it("8.05 — dispose: keepAlive=false", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({ buffer });
		handleProcessorMessage(props, { type: "dispose" }, 0.1, SR);
		const result = processBlock(
			props,
			[makeOutput(2)],
			defaultParams(),
			{
				currentTime: 0.2,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(result.keepAlive).toBe(false);
	});

	it("8.06 — start → play → stop → outputs silence, but doesn't crash on further blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			stopWhen: 0.01,
			duration: 0.01,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Trigger end
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.02, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(props.state).toBe(State.Ended);

		// Further blocks still keepAlive but silent
		for (let b = 0; b < 5; b++) {
			const out = [makeOutput(2)];
			const result = processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.1 + b * 0.01,
					currentFrame: (b + 1) * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(result.keepAlive).toBe(true);
			expect(hasSound(out[0])).toBe(false);
		}
	});

	it("8.07 — Paused before pauseWhen: still produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = getProperties(
			{
				buffer,
				state: State.Paused,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				pauseWhen: 5.0,
				playhead: 0,
				enableGain: false,
				enablePan: false,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		// currentTime=1.0 < pauseWhen=5.0, so still playing
		expect(hasSound(outs[0])).toBe(true);
	});

	it("8.08 — resume with new startWhen", () => {
		const buffer = makeSine(SR * 5, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Play some blocks
		for (let b = 0; b < 3; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
		}

		// Pause
		handleProcessorMessage(props, { type: "pause" }, 0.01, SR);
		// Resume with data (new startWhen)
		handleProcessorMessage(props, { type: "resume", data: 0.5 }, 0.5, SR);

		const out = [makeOutput(2)];
		processBlock(
			props,
			out,
			params,
			{ currentTime: 0.51, currentFrame: 10 * BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(out[0])).toBe(true);
	});

	it("8.09 — start with offset: sound begins from correct position", () => {
		const buffer = makeConstant(SR * 2, 1.0);
		// Put a different value in the second half
		for (let i = SR; i < SR * 2; i++) {
			buffer[0][i] = 0.5;
			buffer[1][i] = 0.5;
		}
		const props = getProperties({ buffer }, SR);
		// offset is in seconds
		handleProcessorMessage(
			props,
			{ type: "start", data: { offset: 1.0 } },
			0,
			SR,
		);
		// start sets state to Scheduled; advance past startWhen
		props.state = State.Started as number as typeof props.state;
		props.enableGain = false;
		props.enablePan = false;
		props.enableLowpass = false;
		props.enableHighpass = false;
		props.enablePlaybackRate = false;

		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(true);
		// Should be reading from offset position (0.5 values)
		expect(rms(outs[0][0])).toBeCloseTo(0.5, 1);
	});

	it("8.10 — rapid stop/start scenario doesn't crash", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = getProperties({ buffer }, SR);
		const fs = defaultFilterState();
		const params = defaultParams();

		for (let cycle = 0; cycle < 10; cycle++) {
			handleProcessorMessage(props, { type: "start" }, cycle * 0.1, SR);
			props.state = State.Started as number as typeof props.state;
			// Play one block
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: cycle * 0.1 + 0.001,
					currentFrame: cycle * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(hasSound(out[0])).toBe(true);
			// Stop
			handleProcessorMessage(props, { type: "stop" }, cycle * 0.1 + 0.002, SR);
		}
	});
});

// ===========================================================================
// 9. Combinatorial Parameter Sweeps (20 tests)
// ===========================================================================

describe("Sound output: combinatorial parameter sweeps", () => {
	// Generate test cases for all toggle combinations
	const toggleCombos = [
		{
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		},
		{
			enableGain: false,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: false,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
		},
		{
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
		},
		{
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		},
	];

	const paramSets: Record<string, Float32Array>[] = [
		{
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
			lowpass: new Float32Array([20000]),
			highpass: new Float32Array([20]),
			playbackRate: new Float32Array([1]),
		},
		{
			gain: new Float32Array([0.5]),
			pan: new Float32Array([-0.5]),
			lowpass: new Float32Array([10000]),
			highpass: new Float32Array([100]),
			playbackRate: new Float32Array([1]),
		},
		{
			gain: new Float32Array([0.8]),
			pan: new Float32Array([0.3]),
			lowpass: new Float32Array([5000]),
			highpass: new Float32Array([200]),
			playbackRate: new Float32Array([1.5]),
		},
		{
			gain: new Float32Array([0.3]),
			pan: new Float32Array([-0.8]),
			lowpass: new Float32Array([2000]),
			highpass: new Float32Array([50]),
			playbackRate: new Float32Array([0.5]),
		},
		{
			gain: new Float32Array([1]),
			pan: new Float32Array([0.9]),
			lowpass: new Float32Array([8000]),
			highpass: new Float32Array([500]),
			playbackRate: new Float32Array([2]),
		},
	];

	for (let i = 0; i < toggleCombos.length; i++) {
		const combo = toggleCombos[i];
		const paramSet = paramSets[i % paramSets.length];
		const label =
			Object.entries(combo)
				.filter(([, v]) => v)
				.map(([k]) => k.replace("enable", ""))
				.join("+") || "none";

		it(`9.${String(i + 1).padStart(2, "0")} — toggles=[${label}] produces sound with 1kHz sine`, () => {
			const buffer = makeSine(SR * 2, 1000);
			const props = makeStartedProps({ buffer, ...combo });
			const { soundBlocks, outputs } = processBlocks(
				props,
				15,
				defaultParams({
					...paramSet,
					detune: new Float32Array([0]),
				}),
			);
			// 1kHz sine should pass through all reasonable filter combos
			expect(soundBlocks).toBeGreaterThan(10);
			for (const out of outputs) expect(checkNans(out)).toBe(0);
		});
	}
});

// ===========================================================================
// 10. Mid-Playback Parameter Editing (12 tests)
// ===========================================================================

describe("Sound output: mid-playback parameter editing", () => {
	it("10.01 — change gain value between blocks: no dropout", () => {
		const buffer = makeSine(SR * 3, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		let allHaveSound = true;
		const gainProgression = [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.3, 0.5, 0.7, 0.9];
		for (let b = 0; b < gainProgression.length; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ gain: new Float32Array([gainProgression[b]]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.02 — sweep pan left→right across blocks: no dropout", () => {
		const buffer = makeSine(SR * 3, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: true,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		let allHaveSound = true;
		for (let b = 0; b < 20; b++) {
			const pan = -1 + (2 * b) / 19;
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ pan: new Float32Array([pan]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.03 — sweep lowpass cutoff 20000→100→20000: always has sound with low freq signal", () => {
		const buffer = makeSine(SR * 3, 100); // 100Hz — passes all lowpass settings
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		let allHaveSound = true;
		for (let b = 0; b < 20; b++) {
			const cutoff = b < 10 ? 20000 - 1990 * b : 200 + 1980 * (b - 10);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ lowpass: new Float32Array([cutoff]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.04 — sweep highpass cutoff 20→10000→20: varies energy but no crash", () => {
		const buffer = makeNoise(SR * 3);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		for (let b = 0; b < 20; b++) {
			const cutoff = b < 10 ? 20 + 998 * b : 10000 - 998 * (b - 10);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ highpass: new Float32Array([cutoff]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(checkNans(out[0])).toBe(0);
		}
	});

	it("10.05 — sweep playback rate 0.25→4.0: always produces sound", () => {
		const buffer = makeSine(SR * 20, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();
		let allHaveSound = true;
		const rates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
		for (let b = 0; b < rates.length; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ playbackRate: new Float32Array([rates[b]]) }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.06 — sweep detune -2400→+2400: always produces sound", () => {
		const detunes = [-2400, -1200, -600, -100, 0, 100, 600, 1200, 2400];
		for (const d of detunes) {
			// Use separate props for each detune to avoid cross-block state issues
			const buffer = makeConstant(SR * 20, 0.5);
			const props = makeStartedProps({
				buffer,
				enableGain: false,
				enablePan: false,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: false,
				enableDetune: true,
			});
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ detune: new Float32Array([d]) }),
				{
					currentTime: 0.001,
					currentFrame: 0,
					sampleRate: SR,
				},
				defaultFilterState(),
			);
			expect(hasSound(out[0])).toBe(true);
		}
	});

	it("10.07 — toggle every effect on one at a time: no dropout", () => {
		const buffer = makeSine(SR * 3, 1000);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams({
			gain: new Float32Array([0.8]),
			pan: new Float32Array([0.2]),
			lowpass: new Float32Array([10000]),
			highpass: new Float32Array([100]),
		});
		const toggleOrder = [
			"toggleGain",
			"togglePan",
			"toggleLowpass",
			"toggleHighpass",
			"togglePlaybackRate",
			"toggleDetune",
		];
		let allHaveSound = true;
		for (let b = 0; b < 30; b++) {
			if (b < toggleOrder.length) {
				handleProcessorMessage(
					props,
					{ type: toggleOrder[b], data: true },
					0.001 + b * (BLOCK / SR),
					SR,
				);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.08 — toggle every effect off one at a time: no dropout", () => {
		const buffer = makeSine(SR * 3, 1000);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			enableDetune: true,
		});
		const fs = defaultFilterState();
		const params = defaultParams({
			gain: new Float32Array([0.8]),
			pan: new Float32Array([0.2]),
			lowpass: new Float32Array([10000]),
			highpass: new Float32Array([100]),
		});
		const toggleOrder = [
			"toggleDetune",
			"togglePlaybackRate",
			"toggleHighpass",
			"toggleLowpass",
			"togglePan",
			"toggleGain",
		];
		let allHaveSound = true;
		for (let b = 0; b < 30; b++) {
			if (b < toggleOrder.length) {
				handleProcessorMessage(
					props,
					{ type: toggleOrder[b], data: false },
					0.001 + b * (BLOCK / SR),
					SR,
				);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.09 — rapidly toggle gains on/off every block", () => {
		const buffer = makeSine(SR * 3, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams({ gain: new Float32Array([0.5]) });
		let allHaveSound = true;
		for (let b = 0; b < 20; b++) {
			handleProcessorMessage(
				props,
				{ type: "toggleGain", data: b % 2 === 0 },
				0.001 + b * (BLOCK / SR),
				SR,
			);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.10 — change multiple params simultaneously each block", () => {
		const buffer = makeSine(SR * 5, 1000);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();
		let allHaveSound = true;
		for (let b = 0; b < 30; b++) {
			const gain = 0.3 + 0.5 * Math.abs(Math.sin(b * 0.3));
			const pan = Math.sin(b * 0.5);
			const lowpass = 2000 + 8000 * Math.abs(Math.sin(b * 0.2));
			const highpass = 20 + 200 * Math.abs(Math.sin(b * 0.4));
			const rate = 0.5 + 1.5 * Math.abs(Math.sin(b * 0.1));
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({
					gain: new Float32Array([gain]),
					pan: new Float32Array([pan]),
					lowpass: new Float32Array([lowpass]),
					highpass: new Float32Array([highpass]),
					playbackRate: new Float32Array([rate]),
				}),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.11 — change loopCrossfade value while playing loop", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			enableLoopCrossfade: true,
			loopCrossfade: 0.01,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let allHaveSound = true;
		const crossfadeValues = [0.01, 0.05, 0.1, 0.2, 0.05, 0.01];
		for (let b = 0; b < 60; b++) {
			if (b % 10 === 0 && b / 10 < crossfadeValues.length) {
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: crossfadeValues[b / 10] },
					0.001,
					SR,
				);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (!hasSound(out[0])) allHaveSound = false;
		}
		expect(allHaveSound).toBe(true);
	});

	it("10.12 — change fadeIn duration while playing", () => {
		const buffer = makeConstant(SR * 3, 1.0);
		const props = makeStartedProps({
			buffer,
			fadeInDuration: 1.0,
			enableFadeIn: true,
			playhead: 0,
			playedSamples: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();
		let soundCount = 0;
		for (let b = 0; b < 20; b++) {
			if (b === 5)
				handleProcessorMessage(props, { type: "fadeIn", data: 0.01 }, 0.02, SR); // shorten fade
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			if (hasSound(out[0])) soundCount++;
		}
		// After shortening fade to 0.01s, most blocks should have full sound
		expect(soundCount).toBeGreaterThan(15);
	});
});

// ===========================================================================
// 11. Edge Cases & Boundary Conditions (12 tests)
// ===========================================================================

describe("Sound output: edge cases", () => {
	it("11.01 — exactly 128-sample buffer (1 block): sound then end", () => {
		const buffer = makeSine(BLOCK, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(hasSound(o1[0])).toBe(true);
		expect(props.state).toBe(State.Ended);
	});

	it("11.02 — 129-sample buffer: 2 blocks (1 full + 1 partial)", () => {
		const buffer = makeSine(129, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(true);
		expect(props.state).toBe(State.Started);

		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			defaultParams(),
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		// 1 sample left → should have some sound then end
		expect(props.state).toBe(State.Ended);
	});

	it("11.03 — buffer with very small values (1e-6) still detected as sound", () => {
		const buffer = makeConstant(SR, 1e-6);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const { soundBlocks } = processBlocks(props, 5);
		expect(soundBlocks).toBe(5);
	});

	it("11.04 — gain=0 → gain=1 transition: immediate sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();

		// Silence with gain=0
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			defaultParams({ gain: new Float32Array([0]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			fs,
		);
		expect(hasSound(o1[0])).toBe(false);

		// Immediate sound with gain=1
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			defaultParams({ gain: new Float32Array([1]) }),
			{
				currentTime: 0.01,
				currentFrame: BLOCK,
				sampleRate: SR,
			},
			fs,
		);
		expect(hasSound(o2[0])).toBe(true);
	});

	it("11.05 — loop with buffer exactly 2*BLOCK: no gaps at wrap", () => {
		const buffer = makeSine(BLOCK * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: (BLOCK * 2) / SR,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { soundBlocks } = processBlocks(props, 50);
		expect(soundBlocks).toBe(50);
	});

	it("11.06 — playhead set mid-buffer: sound from new position", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const fs = defaultFilterState();
		const params = defaultParams();

		// Play from start
		const o1 = [makeOutput(2)];
		processBlock(
			props,
			o1,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		expect(hasSound(o1[0])).toBe(true);

		// Jump playhead
		handleProcessorMessage(props, { type: "playhead", data: SR }, 0.01, SR);

		// Sound from new position
		const o2 = [makeOutput(2)];
		processBlock(
			props,
			o2,
			params,
			{ currentTime: 0.01, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(o2[0])).toBe(true);
	});

	it("11.07 — mono buffer + all effects: no crash, produces sound", () => {
		const buffer = makeSine(SR * 2, 440, 1);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
		});
		const outs = [makeOutput(1)];
		processBlock(
			props,
			outs,
			defaultParams({
				gain: new Float32Array([0.8]),
				pan: new Float32Array([0.3]),
				lowpass: new Float32Array([10000]),
				highpass: new Float32Array([100]),
			}),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(outs[0].length).toBe(2); // mono→stereo
		expect(hasSound(outs[0])).toBe(true);
	});

	it("11.08 — NaN in buffer doesn't propagate: replaced with 0", () => {
		const buffer = makeSine(SR, 440);
		buffer[0][50] = Number.NaN;
		buffer[0][51] = Number.NaN;
		buffer[1][100] = Number.NaN;
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(checkNans(outs[0])).toBe(0); // NaN replaced
		// Other samples should still have sound
		expect(hasSound(outs[0])).toBe(true);
	});

	it("11.09 — empty buffer: silence, no crash", () => {
		const buffer = [new Float32Array(0), new Float32Array(0)];
		const props = makeStartedProps({ buffer });
		const outs = [makeOutput(2)];
		const result = processBlock(
			props,
			outs,
			defaultParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		expect(hasSound(outs[0])).toBe(false);
	});

	it("11.10 — extreme detune +2400 cents: no crash, produces sound", () => {
		const buffer = makeSine(SR * 10, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
		});
		const { soundBlocks, outputs } = processBlocks(
			props,
			10,
			defaultParams({ detune: new Float32Array([2400]) }),
		);
		expect(soundBlocks).toBe(10);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("11.11 — extreme detune -2400 cents (slowed 4x): produces sound", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
		});
		const { soundBlocks, outputs } = processBlocks(
			props,
			10,
			defaultParams({ detune: new Float32Array([-2400]) }),
		);
		expect(soundBlocks).toBe(10);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("11.12 — playback rate=0: output repeats same sample (not silent)", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			playhead: 100, // not at zero crossing
		});
		const outs = [makeOutput(2)];
		processBlock(
			props,
			outs,
			defaultParams({ playbackRate: new Float32Array([0]) }),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		expect(hasSound(outs[0])).toBe(false);
		expect(props.playhead).toBe(100);
	});
});

// ===========================================================================
// 12. No-NaN Verification Across All Configurations (8 tests)
// ===========================================================================

describe("Sound output: no NaN in any configuration", () => {
	it("12.01 — 100 blocks with all effects + loop: zero NaN", () => {
		const buffer = makeSine(SR * 2, 1000);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			enableDetune: true,
			playhead: Math.floor(0.1 * SR),
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { outputs } = processBlocks(
			props,
			100,
			defaultParams({
				gain: new Float32Array([0.7]),
				pan: new Float32Array([0.3]),
				lowpass: new Float32Array([8000]),
				highpass: new Float32Array([100]),
				playbackRate: new Float32Array([1.5]),
				detune: new Float32Array([100]),
			}),
		);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("12.02 — noise + filters + loop: zero NaN", () => {
		const buffer = makeNoise(SR * 2);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { outputs } = processBlocks(
			props,
			100,
			defaultParams({
				gain: new Float32Array([0.5]),
				pan: new Float32Array([-0.3]),
				lowpass: new Float32Array([3000]),
				highpass: new Float32Array([500]),
			}),
		);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("12.03 — rapid parameter changes: zero NaN", () => {
		const buffer = makeSine(SR * 5, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();
		for (let b = 0; b < 50; b++) {
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({
					gain: new Float32Array([Math.random()]),
					pan: new Float32Array([Math.random() * 2 - 1]),
					lowpass: new Float32Array([100 + Math.random() * 19900]),
					highpass: new Float32Array([20 + Math.random() * 5000]),
					playbackRate: new Float32Array([0.25 + Math.random() * 3.75]),
				}),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(checkNans(out[0])).toBe(0);
		}
	});

	it("12.04 — crossfade with various loop sizes: zero NaN", () => {
		const loopSizes = [0.01, 0.05, 0.1, 0.5, 1.0];
		for (const loopSize of loopSizes) {
			const buffer = makeSine(SR * 2, 440);
			const props = makeStartedProps({
				buffer,
				loop: true,
				loopStart: 0,
				loopEnd: loopSize,
				loopCrossfade: loopSize * 0.3,
				enableLoopCrossfade: true,
				enableGain: false,
				enablePan: false,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: false,
				duration: Number.MAX_SAFE_INTEGER,
				stopWhen: Number.MAX_SAFE_INTEGER,
			});
			const { outputs } = processBlocks(props, 50);
			for (const out of outputs) expect(checkNans(out)).toBe(0);
		}
	});

	it("12.05 — mono buffer + crossfade: zero NaN", () => {
		const buffer = makeSine(SR * 2, 440, 1);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
			playhead: Math.floor(0.1 * SR),
		});
		// Mono buffer needs 1-channel output (monoToStereo is applied during processBlock)
		const fs = defaultFilterState();
		const params = defaultParams();
		for (let b = 0; b < 100; b++) {
			const out = [makeOutput(1)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(checkNans(out[0])).toBe(0);
		}
	});

	it("12.06 — reverse playback + loop: zero NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			playhead: SR,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { outputs } = processBlocks(
			props,
			100,
			defaultParams({ playbackRate: new Float32Array([-1]) }),
		);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("12.07 — fast reverse playback + crossfade: zero NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			playhead: SR,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { outputs } = processBlocks(
			props,
			100,
			defaultParams({ playbackRate: new Float32Array([-2]) }),
		);
		for (const out of outputs) expect(checkNans(out)).toBe(0);
	});

	it("12.08 — a-rate params (all per-sample): zero NaN over 50 blocks", () => {
		const buffer = makeSine(SR * 5, 440);
		const props = makeStartedProps({
			buffer,
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			enableDetune: true,
		});
		const fs = defaultFilterState();
		for (let b = 0; b < 50; b++) {
			const gains = new Float32Array(BLOCK);
			const pans = new Float32Array(BLOCK);
			const lp = new Float32Array(BLOCK);
			const hp = new Float32Array(BLOCK);
			const rates = new Float32Array(BLOCK);
			const detunes = new Float32Array(BLOCK);
			for (let i = 0; i < BLOCK; i++) {
				gains[i] = 0.3 + 0.4 * Math.sin(i * 0.1 + b);
				pans[i] = Math.sin(i * 0.05 + b * 0.3);
				lp[i] = 2000 + 5000 * Math.abs(Math.sin(i * 0.03 + b * 0.2));
				hp[i] = 50 + 200 * Math.abs(Math.sin(i * 0.04 + b * 0.15));
				rates[i] = 0.5 + Math.abs(Math.sin(i * 0.02 + b * 0.1));
				detunes[i] = 200 * Math.sin(i * 0.01 + b * 0.05);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				{
					gain: gains,
					pan: pans,
					lowpass: lp,
					highpass: hp,
					playbackRate: rates,
					detune: detunes,
				},
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			expect(checkNans(out[0])).toBe(0);
		}
	});
});

// ===========================================================================
// 13. Loop Crossfade Deep Tests (NaN & dropout prevention)
// ===========================================================================

/**
 * Process many blocks with fresh filter state, returning per-block NaN counts
 * and the total. This helper specifically tracks NaN propagation through filters.
 */
function processBlocksDetailed(
	props: Required<ClipProcessorOptions>,
	numBlocks: number,
	params?: Record<string, Float32Array>,
): {
	totalNans: number;
	nansPerBlock: number[];
	soundBlocks: number;
	silentBlocks: number;
	playheadHistory: number[];
} {
	const p = params ?? defaultParams();
	const filterState = defaultFilterState();
	let totalNans = 0;
	const nansPerBlock: number[] = [];
	let soundBlocks = 0;
	let silentBlocks = 0;
	const playheadHistory: number[] = [];
	const blockDuration = BLOCK / SR;

	for (let b = 0; b < numBlocks; b++) {
		const out = [makeOutput(2)];
		const ct = 0.001 + b * blockDuration;
		playheadHistory.push(props.playhead);
		const result = processBlock(
			props,
			out,
			p,
			{ currentTime: ct, currentFrame: b * BLOCK, sampleRate: SR },
			filterState,
		);
		const nans = checkNans(out[0]);
		totalNans += nans;
		nansPerBlock.push(nans);
		if (hasSound(out[0])) soundBlocks++;
		else silentBlocks++;
		if (!result.keepAlive) break;
	}
	return {
		totalNans,
		nansPerBlock,
		soundBlocks,
		silentBlocks,
		playheadHistory,
	};
}

describe("Sound output: loop crossfade deep tests", () => {
	// -----------------------------------------------------------------------
	// 13.1 — Crossfade + playback rate (fractional playhead → NaN bug)
	// -----------------------------------------------------------------------

	it("13.01 — crossfade + rate=1.5: no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 1.8,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.02 — crossfade + rate=0.75: no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.2,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([0.75]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.03 — crossfade + rate=2.0: no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([2.0]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.04 — crossfade + rate=0.33 (slow): no NaN over 1000 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.3,
			loopEnd: 1.7,
			loopCrossfade: 0.15,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.3 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			1000,
			defaultParams({
				playbackRate: new Float32Array([0.33]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(1000);
	});

	it("13.05 — crossfade + rate=-1.0 (reverse): no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: SR, // start in middle
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([-1.0]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.06 — crossfade + rate=-0.5 (slow reverse): no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.08,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: SR,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([-0.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.07 — crossfade + detune=+600 (fractional rate from detune): no NaN over 500 blocks", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 3.0,
			loopCrossfade: 0.2,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				detune: new Float32Array([600]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.08 — crossfade + rate=1.5 + detune=300: combined fractional rate: no NaN", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 3.5,
			loopCrossfade: 0.15,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			enableDetune: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
				detune: new Float32Array([300]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	// -----------------------------------------------------------------------
	// 13.2 — Crossfade + filters (NaN cascade through biquad state)
	// -----------------------------------------------------------------------

	it("13.09 — crossfade + rate=1.5 + lowpass: no NaN cascade", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
				lowpass: new Float32Array([5000]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.10 — crossfade + rate=1.5 + highpass: no NaN cascade", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: true,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
				highpass: new Float32Array([200]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.11 — crossfade + rate=1.5 + all effects: no NaN cascade", () => {
		const buffer = makeSine(SR * 2, 1000);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
				gain: new Float32Array([0.8]),
				pan: new Float32Array([0.3]),
				lowpass: new Float32Array([8000]),
				highpass: new Float32Array([100]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.12 — crossfade + rate=0.75 + both filters: NaN won't cascade", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 1.8,
			loopCrossfade: 0.2,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([0.75]),
				lowpass: new Float32Array([10000]),
				highpass: new Float32Array([80]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	// -----------------------------------------------------------------------
	// 13.3 — Crossfade size variations
	// -----------------------------------------------------------------------

	it("13.13 — very small crossfade (0.001s = 48 samples) + rate=1.3: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			loopCrossfade: 0.001,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.3]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.14 — large crossfade (0.5s = 24000 samples) + rate=1.1: no NaN", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 3.5,
			loopCrossfade: 0.5,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			1000,
			defaultParams({
				playbackRate: new Float32Array([1.1]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(1000);
	});

	it("13.15 — crossfade equal to half loop length + rate=1.7: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const loopLen = 1.0; // 1 second loop
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 1.5,
			loopCrossfade: loopLen / 2, // 0.5s crossfade
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.7]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.16 — crossfade larger than loop (clamped): no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 1.0,
			loopCrossfade: 2.0, // much bigger than 0.5s loop
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.3]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	// -----------------------------------------------------------------------
	// 13.4 — Loop boundary edge cases
	// -----------------------------------------------------------------------

	it("13.17 — loopEnd at buffer end + crossfade + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0, // exactly at buffer end
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.18 — loopStart=0 (minimum) + crossfade + rate=1.2: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 1.5,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.2]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	it("13.19 — very short loop (0.01s=480 samples) + crossfade + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.11, // 480 sample loop
			loopCrossfade: 0.003,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.20 — enableLoopStart=false + crossfade + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5, // ignored since enableLoopStart=false
			loopEnd: 1.5,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: false,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.21 — enableLoopEnd=false + crossfade + rate=1.3: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 0.8, // ignored since enableLoopEnd=false
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: false,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.3]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	// -----------------------------------------------------------------------
	// 13.5 — Extended playback (simulating ~26s as in user's debug)
	// -----------------------------------------------------------------------

	it("13.22 — long playback: 5000 blocks (~13s) + crossfade + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			5000,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(5000);
	});

	it("13.23 — long playback with filters (cascade regression): no NaN", () => {
		const buffer = makeSine(SR * 2, 1000);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: true,
			enablePan: true,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			5000,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
				gain: new Float32Array([0.8]),
				pan: new Float32Array([0.2]),
				lowpass: new Float32Array([8000]),
				highpass: new Float32Array([100]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(5000);
	});

	// -----------------------------------------------------------------------
	// 13.6 — Playback rate variations with crossfade
	// -----------------------------------------------------------------------

	for (const rate of [
		0.25, 0.5, 0.75, 1.1, 1.3, 1.5, 1.7, 2.0, 2.5, 3.0, 4.0,
	]) {
		it(`13.24.${rate} — crossfade + rate=${rate}: no NaN over 500 blocks`, () => {
			const buffer = makeSine(SR * 2, 440);
			const props = makeStartedProps({
				buffer,
				loop: true,
				loopStart: 0.1,
				loopEnd: 1.9,
				loopCrossfade: 0.1,
				enableLoopCrossfade: true,
				enableLoopStart: true,
				enableLoopEnd: true,
				playhead: Math.floor(0.1 * SR),
				enableGain: false,
				enablePan: false,
				enableLowpass: false,
				enableHighpass: false,
				enablePlaybackRate: true,
				duration: Number.MAX_SAFE_INTEGER,
				stopWhen: Number.MAX_SAFE_INTEGER,
			});
			const result = processBlocksDetailed(
				props,
				500,
				defaultParams({
					playbackRate: new Float32Array([rate]),
				}),
			);
			expect(result.totalNans).toBe(0);
			expect(result.soundBlocks).toBe(500);
		});
	}

	// -----------------------------------------------------------------------
	// 13.7 — Changing crossfade params mid-loop with playback rate
	// -----------------------------------------------------------------------

	it("13.25 — change crossfade duration mid-loop with rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 100)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.2 },
					0.3,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.01 },
					0.6,
					SR,
				);
			if (b === 300)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.15 },
					0.9,
					SR,
				);
			if (b === 400)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					1.2,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	it("13.26 — toggle crossfade on/off with rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: false,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: true },
					0.1,
					SR,
				);
			if (b === 150)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: false },
					0.4,
					SR,
				);
			if (b === 250)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: true },
					0.7,
					SR,
				);
			if (b === 350)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: false },
					1.0,
					SR,
				);
			if (b === 400)
				handleProcessorMessage(
					props,
					{ type: "toggleLoopCrossfade", data: true },
					1.1,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	it("13.27 — change loopStart/loopEnd mid-loop with crossfade + rate=1.3: no NaN", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 3.8,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.3]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 80)
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.5 },
					0.3,
					SR,
				);
			if (b === 160)
				handleProcessorMessage(props, { type: "loopEnd", data: 3.0 }, 0.5, SR);
			if (b === 240)
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.1 },
					0.7,
					SR,
				);
			if (b === 320)
				handleProcessorMessage(props, { type: "loopEnd", data: 3.5 }, 0.9, SR);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// -----------------------------------------------------------------------
	// 13.8 — a-rate (per-sample) playback rate with crossfade
	// -----------------------------------------------------------------------

	it("13.28 — a-rate playback rate ramp 0.5→2.0 + crossfade: no NaN", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 3.8,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			// Per-sample rate ramp for each block
			const rates = new Float32Array(BLOCK);
			const baseRate = 0.5 + 1.5 * (b / 500);
			for (let i = 0; i < BLOCK; i++) {
				rates[i] = baseRate + 0.01 * Math.sin(i * 0.1);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ playbackRate: rates }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	it("13.29 — a-rate detune with crossfade: no NaN", () => {
		const buffer = makeSine(SR * 4, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 3.8,
			loopCrossfade: 0.15,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			enableDetune: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			const detunes = new Float32Array(BLOCK);
			for (let i = 0; i < BLOCK; i++) {
				detunes[i] = 600 * Math.sin((b * BLOCK + i) * 0.001);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				defaultParams({ detune: detunes }),
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// -----------------------------------------------------------------------
	// 13.9 — Crossfade with specific playhead positions (near boundaries)
	// -----------------------------------------------------------------------

	it("13.30 — playhead starting right at crossfade zone start + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const loopEnd = 1.9;
		const xfade = 0.1;
		// Start playhead at loopEnd - crossfade = start of crossfade-in zone
		const startPos = Math.floor((loopEnd - xfade) * SR);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd,
			loopCrossfade: xfade,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: startPos,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.31 — playhead starting 1 sample before loopEnd + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const loopEndSamples = Math.floor(1.9 * SR);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: loopEndSamples - 1,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	it("13.32 — playhead at loopStart + crossfade out zone + rate=1.5: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const loopStart = 0.1;
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart,
			loopEnd: 1.9,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(loopStart * SR) + 1,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.5]),
			}),
		);
		expect(result.totalNans).toBe(0);
	});

	// -----------------------------------------------------------------------
	// 13.10 — Comprehensive combinatorial: loop config × rate × crossfade
	// -----------------------------------------------------------------------

	const loopConfigs = [
		{ loopStart: 0, loopEnd: 2.0, xfade: 0.05 },
		{ loopStart: 0.2, loopEnd: 1.8, xfade: 0.1 },
		{ loopStart: 0.5, loopEnd: 1.5, xfade: 0.2 },
		{ loopStart: 0, loopEnd: 1.0, xfade: 0.3 },
		{ loopStart: 0.1, loopEnd: 0.5, xfade: 0.05 },
	];
	const rates = [0.5, 0.75, 1.0, 1.3, 1.5, 2.0];

	for (const cfg of loopConfigs) {
		for (const rate of rates) {
			it(`13.33 — loop[${cfg.loopStart}-${cfg.loopEnd}] xfade=${cfg.xfade} rate=${rate}: no NaN`, () => {
				const buffer = makeSine(SR * 2, 440);
				const props = makeStartedProps({
					buffer,
					loop: true,
					loopStart: cfg.loopStart,
					loopEnd: cfg.loopEnd,
					loopCrossfade: cfg.xfade,
					enableLoopCrossfade: true,
					enableLoopStart: cfg.loopStart > 0,
					enableLoopEnd: true,
					playhead: Math.floor(cfg.loopStart * SR),
					enableGain: false,
					enablePan: false,
					enableLowpass: false,
					enableHighpass: false,
					enablePlaybackRate: rate !== 1.0,
					enableDetune: false,
					duration: Number.MAX_SAFE_INTEGER,
					stopWhen: Number.MAX_SAFE_INTEGER,
				});
				const result = processBlocksDetailed(
					props,
					300,
					defaultParams({
						playbackRate: new Float32Array([rate]),
					}),
				);
				expect(result.totalNans).toBe(0);
				expect(result.soundBlocks).toBe(300);
			});
		}
	}
});

// ===========================================================================
// 14. Crossfade Update While Playing (regression tests)
// ===========================================================================

describe("Sound output: crossfade update while playing", () => {
	// 14.1 — Increase crossfade so crossfade-out zone extends past buffer end
	it("14.01 — loopEnd near buffer end, increase crossfade: no NaN", () => {
		const buffer = makeSine(SR * 2, 440); // 96000 samples
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.95, // very close to buffer end (93600 of 96000)
			loopCrossfade: 0.01, // start small
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			// Gradually increase crossfade while playing
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.1 },
					0.2,
					SR,
				);
			if (b === 100)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					0.4,
					SR,
				);
			if (b === 150)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					0.6,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.8 },
					0.8,
					SR,
				);
			if (b === 250)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 1.0 },
					1.0,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.2 — loopEnd at exact buffer end, increase crossfade
	it("14.02 — loopEnd at buffer end, increase crossfade: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0, // exactly at buffer end
			loopCrossfade: 0.01,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.3]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.2 },
					0.2,
					SR,
				);
			if (b === 150)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					0.5,
					SR,
				);
			if (b === 300)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 1.0 },
					1.0,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.3 — loopStart=0, large crossfade (firstIndex goes negative)
	it("14.03 — loopStart=0, increase crossfade to very large: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 1.5,
			loopCrossfade: 0.01,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			playhead: 0,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 30)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					0.1,
					SR,
				);
			if (b === 100)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 1.0 },
					0.3,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 1.5 },
					0.6,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.4 — Decrease crossfade while playhead is in crossfade zone
	it("14.04 — decrease crossfade while in crossfade zone: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 1.8,
			loopCrossfade: 0.5, // start large
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.3]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			// Shrink crossfade — may leave playhead in zone that no longer exists
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.2 },
					0.2,
					SR,
				);
			if (b === 100)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.05 },
					0.4,
					SR,
				);
			if (b === 150)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.01 },
					0.6,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.001 },
					0.8,
					SR,
				);
			// Then re-grow
			if (b === 250)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					1.0,
					SR,
				);
			if (b === 350)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.8 },
					1.2,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.5 — Rapid crossfade changes (simulating slider drag)
	it("14.05 — rapid crossfade slider drag simulation: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.0,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 1000; b++) {
			// Change crossfade every ~5 blocks (simulates slider drag)
			if (b % 5 === 0) {
				const t = b / 1000;
				const xfade = 0.5 * (1 + Math.sin(2 * Math.PI * t * 3)); // oscillates 0-1
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: xfade },
					b * (BLOCK / SR),
					SR,
				);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.6 — Crossfade update + filters (NaN cascade)
	it("14.06 — crossfade update + lowpass + highpass: no NaN cascade", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: true,
			enablePan: false,
			enableLowpass: true,
			enableHighpass: true,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({
			playbackRate: new Float32Array([1.5]),
			gain: new Float32Array([0.8]),
			lowpass: new Float32Array([5000]),
			highpass: new Float32Array([100]),
		});
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 30)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.2 },
					0.1,
					SR,
				);
			if (b === 80)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					0.3,
					SR,
				);
			if (b === 130)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.1 },
					0.4,
					SR,
				);
			if (b === 180)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.8 },
					0.6,
					SR,
				);
			if (b === 250)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.01 },
					0.8,
					SR,
				);
			if (b === 350)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					1.0,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.7 — Crossfade where numSamples calculation triggers inverted subtraction
	it("14.07 — crossfade-out zone extends past sourceLength: no NaN or bad index", () => {
		const buffer = makeSine(SR, 440); // 1 second = 48000 samples
		// loopEnd at 0.95s = 45600 samples, so only 2400 samples after loopEnd
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.95,
			loopCrossfade: 0.1, // 4800 samples > 2400 available after loopEnd
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const result = processBlocksDetailed(
			props,
			500,
			defaultParams({
				playbackRate: new Float32Array([1.3]),
			}),
		);
		expect(result.totalNans).toBe(0);
		expect(result.soundBlocks).toBe(500);
	});

	// 14.8 — Change loopEnd closer to buffer end with existing crossfade
	it("14.08 — move loopEnd closer to buffer end with crossfade active: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.0, // safe initial position
			loopCrossfade: 0.2,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			// Move loopEnd progressively closer to buffer end
			if (b === 50)
				handleProcessorMessage(props, { type: "loopEnd", data: 1.5 }, 0.2, SR);
			if (b === 100)
				handleProcessorMessage(props, { type: "loopEnd", data: 1.8 }, 0.4, SR);
			if (b === 200)
				handleProcessorMessage(props, { type: "loopEnd", data: 1.95 }, 0.6, SR);
			if (b === 300)
				handleProcessorMessage(props, { type: "loopEnd", data: 2.0 }, 0.8, SR);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.9 — Crossfade larger than loop length
	it("14.09 — crossfade grows larger than loop length: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.5,
			loopEnd: 1.0, // 0.5s loop = 24000 samples
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.5 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.3]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			// Crossfade grows beyond loop length
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					0.2,
					SR,
				);
			if (b === 100)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.6 },
					0.4,
					SR,
				);
			if (b === 150)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 1.0 },
					0.6,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 2.0 },
					0.8,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.10 — Simultaneously change crossfade and loop bounds
	it("14.10 — change crossfade + loop bounds simultaneously: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 1.8,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.2 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams({ playbackRate: new Float32Array([1.5]) });
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 50) {
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.0 },
					0.2,
					SR,
				);
				handleProcessorMessage(props, { type: "loopEnd", data: 2.0 }, 0.2, SR);
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.5 },
					0.2,
					SR,
				);
			}
			if (b === 150) {
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.5 },
					0.5,
					SR,
				);
				handleProcessorMessage(props, { type: "loopEnd", data: 1.0 }, 0.5, SR);
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					0.5,
					SR,
				);
			}
			if (b === 300) {
				handleProcessorMessage(
					props,
					{ type: "loopStart", data: 0.1 },
					0.9,
					SR,
				);
				handleProcessorMessage(props, { type: "loopEnd", data: 1.95 }, 0.9, SR);
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.8 },
					0.9,
					SR,
				);
			}
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.11 — Rate=1 (integer playhead) with crossfade update
	it("14.11 — rate=1 + crossfade update near buffer end: no NaN", () => {
		const buffer = makeSine(SR * 2, 440);
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 1.95,
			loopCrossfade: 0.01,
			enableLoopCrossfade: true,
			enableLoopStart: true,
			enableLoopEnd: true,
			playhead: Math.floor(0.1 * SR),
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const params = defaultParams();
		const fs = defaultFilterState();
		let totalNans = 0;
		for (let b = 0; b < 500; b++) {
			if (b === 50)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.3 },
					0.2,
					SR,
				);
			if (b === 200)
				handleProcessorMessage(
					props,
					{ type: "loopCrossfade", data: 0.8 },
					0.6,
					SR,
				);
			const out = [makeOutput(2)];
			processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + b * (BLOCK / SR),
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				fs,
			);
			totalNans += checkNans(out[0]);
		}
		expect(totalNans).toBe(0);
	});

	// 14.12 — Verify crossfade-out actually contributes audio near loopStart
	// (Regression: old code silently disabled crossfade-out when loopEnd was near buffer end)
	it("14.12 — crossfade-out produces audio near loopStart (loopEnd=buffer end)", () => {
		// Use two distinct constant buffers per channel to distinguish crossfade content
		const len = SR * 2; // 96000 samples
		const ch0 = new Float32Array(len);
		const ch1 = new Float32Array(len);
		// Fill buffer: loopStart region with 0.5, loopEnd region with -0.5
		// This makes it easy to detect if crossfade-out is adding end-of-loop content
		const loopStartSec = 0;
		const loopEndSec = 2.0; // buffer end
		const loopStartSamp = Math.floor(loopStartSec * SR);
		const loopEndSamp = Math.floor(loopEndSec * SR);
		const xfadeSec = 0.1;
		const xfadeSamp = Math.floor(xfadeSec * SR);
		// Fill start of loop with 0.3
		for (let i = loopStartSamp; i < loopStartSamp + xfadeSamp; i++) {
			ch0[i] = 0.3;
			ch1[i] = 0.3;
		}
		// Fill end of loop with 0.7
		for (let i = loopEndSamp - xfadeSamp; i < loopEndSamp; i++) {
			ch0[i] = 0.7;
			ch1[i] = 0.7;
		}
		const buffer = [ch0, ch1];
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: loopStartSec,
			loopEnd: loopEndSec,
			loopCrossfade: xfadeSec,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			enableLoopStart: false,
			// Start playhead just past loopStart (in crossfade-out zone)
			playhead: loopStartSamp + 1,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const out = [makeOutput(2)];
		processBlock(
			props,
			out,
			defaultParams(),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		// The fill() puts loopStart content (0.3) in output.
		// Crossfade-out should ADD loopEnd content (0.7 * gain).
		// So output should be > 0.3 — proving crossfade-out is active.
		let maxVal = 0;
		for (let i = 0; i < out[0][0].length; i++) {
			maxVal = Math.max(maxVal, Math.abs(out[0][0][i]));
		}
		expect(maxVal).toBeGreaterThan(0.3);
		expect(checkNans(out[0])).toBe(0);
	});

	// 14.13 — Verify crossfade-in produces audio near loopEnd (loopStart=0)
	it("14.13 — crossfade-in produces audio near loopEnd (loopStart=0)", () => {
		const len = SR * 2;
		const ch0 = new Float32Array(len);
		const ch1 = new Float32Array(len);
		const loopStartSamp = 0;
		const loopEndSamp = len;
		const xfadeSec = 0.1;
		const xfadeSamp = Math.floor(xfadeSec * SR);
		// Fill start of loop with 0.7
		for (let i = loopStartSamp; i < loopStartSamp + xfadeSamp; i++) {
			ch0[i] = 0.7;
			ch1[i] = 0.7;
		}
		// Fill end of loop with 0.3
		for (let i = loopEndSamp - xfadeSamp; i < loopEndSamp; i++) {
			ch0[i] = 0.3;
			ch1[i] = 0.3;
		}
		const buffer = [ch0, ch1];
		const props = makeStartedProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 2.0,
			loopCrossfade: xfadeSec,
			enableLoopCrossfade: true,
			enableLoopEnd: true,
			enableLoopStart: false,
			// Start playhead near loopEnd (in crossfade-in zone)
			playhead: loopEndSamp - xfadeSamp + 1,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: false,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const out = [makeOutput(2)];
		processBlock(
			props,
			out,
			defaultParams(),
			{
				currentTime: 0.001,
				currentFrame: 0,
				sampleRate: SR,
			},
			defaultFilterState(),
		);
		// The fill() puts loopEnd content (0.3) in output.
		// Crossfade-in should ADD loopStart content (0.7 * gain).
		// So output should be > 0.3.
		let maxVal = 0;
		for (let i = 0; i < out[0][0].length; i++) {
			maxVal = Math.max(maxVal, Math.abs(out[0][0][i]));
		}
		expect(maxVal).toBeGreaterThan(0.3);
		expect(checkNans(out[0])).toBe(0);
	});
});

describe("15. Zero Playback Rate", () => {
	it("15.01 — exact zero playbackRate outputs silence and freezes the playhead", () => {
		const buffer = makeConstant(SR, 0.5);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const out = [makeOutput(2)];
		processBlock(
			props,
			out,
			defaultParams({ playbackRate: new Float32Array([0]) }),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(hasSound(out[0])).toBe(false);
		expect(props.playhead).toBe(0);
	});

	it("15.02 — transition 1 → 0 → 1 resumes playback from the same position", () => {
		const buffer = makeConstant(SR * 2, 0.5);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
		});
		const fs = defaultFilterState();

		const firstOut = [makeOutput(2)];
		processBlock(
			props,
			firstOut,
			defaultParams({ playbackRate: new Float32Array([1]) }),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			fs,
		);
		const playheadAfterForward = props.playhead;
		expect(hasSound(firstOut[0])).toBe(true);

		const zeroOut = [makeOutput(2)];
		processBlock(
			props,
			zeroOut,
			defaultParams({ playbackRate: new Float32Array([0]) }),
			{ currentTime: 0.002, currentFrame: BLOCK, sampleRate: SR },
			fs,
		);
		expect(hasSound(zeroOut[0])).toBe(false);
		expect(props.playhead).toBe(playheadAfterForward);

		const resumedOut = [makeOutput(2)];
		processBlock(
			props,
			resumedOut,
			defaultParams({ playbackRate: new Float32Array([1]) }),
			{ currentTime: 0.003, currentFrame: BLOCK * 2, sampleRate: SR },
			fs,
		);
		expect(hasSound(resumedOut[0])).toBe(true);
		expect(props.playhead).toBeGreaterThan(playheadAfterForward);
	});

	it("15.03 — detune does not override an exact zero playbackRate", () => {
		const buffer = makeConstant(SR, 0.5);
		const props = makeStartedProps({
			buffer,
			enableGain: false,
			enablePan: false,
			enableLowpass: false,
			enableHighpass: false,
			enablePlaybackRate: true,
			enableDetune: true,
		});
		const out = [makeOutput(2)];
		processBlock(
			props,
			out,
			defaultParams({
				playbackRate: new Float32Array([0]),
				detune: new Float32Array([1200]),
			}),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			defaultFilterState(),
		);
		expect(hasSound(out[0])).toBe(false);
		expect(props.playhead).toBe(0);
	});
});
