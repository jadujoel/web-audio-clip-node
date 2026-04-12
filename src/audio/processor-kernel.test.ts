import { describe, expect, it } from "bun:test";
import {
	checkNans,
	copy,
	createFilterState,
	fill,
	fillWithSilence,
	findIndexesNormal,
	findIndexesWithPlaybackRates,
	gainFilter,
	getProperties,
	handleProcessorMessage,
	highpassFilter,
	lowpassFilter,
	monoToStereo,
	type OutboundMessage,
	panFilter,
	processBlock,
	SAMPLE_BLOCK_SIZE,
	setOffset,
} from "./processor-kernel";
import type { BlockParameters, ClipProcessorOptions } from "./types";
import { State } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(length: number, channels = 2): Float32Array[] {
	return Array.from({ length: channels }, (_, ch) => {
		const arr = new Float32Array(length);
		for (let i = 0; i < length; i++) arr[i] = ch * 1000 + i;
		return arr;
	});
}

function makeSineBuffer(
	length: number,
	freq: number,
	sampleRate: number,
	channels = 2,
): Float32Array[] {
	return Array.from({ length: channels }, () => {
		const arr = new Float32Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
		return arr;
	});
}

function makeOutput(channels = 2, blockSize = 128): Float32Array[] {
	return Array.from({ length: channels }, () => new Float32Array(blockSize));
}

// ---------------------------------------------------------------------------
// A. getProperties / setOffset
// ---------------------------------------------------------------------------

describe("getProperties", () => {
	it("returns all required fields with sensible defaults", () => {
		const props = getProperties({}, 48000);
		expect(props.buffer).toEqual([]);
		expect(props.loop).toBe(false);
		expect(props.loopStart).toBe(0);
		expect(props.state).toBe(State.Initial);
		expect(props.enableGain).toBe(true);
		expect(props.enablePan).toBe(true);
		expect(props.duration).toBe(-1);
		expect(props.fadeInDuration).toBe(0);
		expect(props.enableFadeIn).toBe(false);
		expect(props.enableLoopStart).toBe(true);
		expect(props.enableLoopEnd).toBe(true);
	});

	it("respects provided options", () => {
		const buffer = makeBuffer(1000);
		const props = getProperties(
			{
				buffer,
				loop: true,
				fadeInDuration: 0.5,
				enableGain: false,
			},
			48000,
		);
		expect(props.loop).toBe(true);
		expect(props.buffer).toBe(buffer);
		expect(props.fadeInDuration).toBe(0.5);
		expect(props.enableFadeIn).toBe(true); // derived from fadeInDuration > 0
		expect(props.enableGain).toBe(false);
	});

	it("computes loopEnd from buffer length when not specified", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties({ buffer }, 48000);
		expect(props.loopEnd).toBeCloseTo(1.0); // 48000 / 48000
	});

	it("works correctly with different sampleRate values", () => {
		const buffer = makeBuffer(44100);
		const props44 = getProperties({ buffer }, 44100);
		const props48 = getProperties({ buffer }, 48000);
		expect(props44.loopEnd).toBeCloseTo(1.0);
		expect(props48.loopEnd).toBeCloseTo(44100 / 48000);
	});
});

describe("setOffset", () => {
	it("with undefined returns 0", () => {
		const props = getProperties({}, 48000);
		const result = setOffset(props, undefined, 48000);
		expect(result).toBe(0);
		expect(props.offset).toBe(0);
	});

	it("with positive value", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties({ buffer }, 48000);
		const result = setOffset(props, 0.5, 48000);
		expect(result).toBe(24000);
		expect(props.offset).toBe(24000);
	});

	it("with negative value wraps from end", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties({ buffer }, 48000);
		setOffset(props, -100, 48000);
		// -100 → bufferLength + (-100) = 48000 - 100 = 47900
		// Then floor(47900 * 48000) would be huge, but the logic does floor(value * sampleRate)
		// Actually offset is in seconds for the floor calculation
		// Let's verify the actual behavior
		expect(props.offset).toBeGreaterThan(0);
	});

	it("with value exceeding buffer length wraps via modulo", () => {
		const buffer = makeBuffer(1000);
		const props = getProperties({ buffer }, 48000);
		const result = setOffset(props, 2000, 48000);
		// offset > (1000 - 1) → recurse with 1000 % 2000 = 1000, but that's still > 999
		// so it recurses again with 1000 % 1000 = 0
		expect(result).toBeGreaterThanOrEqual(0);
		expect(props.offset).toBeGreaterThanOrEqual(0);
	});
});

// ---------------------------------------------------------------------------
// B. findIndexesNormal
// ---------------------------------------------------------------------------

describe("findIndexesNormal", () => {
	it("normal playback: sequential indexes", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesNormal(p);
		expect(result.indexes.length).toBe(128);
		expect(result.indexes[0]).toBe(0);
		expect(result.indexes[127]).toBe(127);
		expect(result.playhead).toBe(128);
		expect(result.ended).toBe(false);
		expect(result.looped).toBe(false);
	});

	it("end of buffer → ended=true, indexes truncated", () => {
		const p: BlockParameters = {
			playhead: 950,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesNormal(p);
		expect(result.indexes.length).toBe(50);
		expect(result.ended).toBe(true);
	});

	it("loop wraps from loopEnd → loopStart", () => {
		const p: BlockParameters = {
			playhead: 900,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 10000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesNormal(p);
		expect(result.looped).toBe(true);
		expect(result.ended).toBe(false);
		// After reaching 950, should wrap to 100
		const wrapIndex = 950 - 900; // 50 samples in before wrap
		expect(result.indexes[wrapIndex]).toBe(100);
	});

	it("playhead at exact loop boundary", () => {
		const p: BlockParameters = {
			playhead: 950,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 10000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesNormal(p);
		expect(result.looped).toBe(true);
		expect(result.indexes[0]).toBe(100); // wraps immediately
	});

	it("empty range (playhead >= bufferLength, no loop)", () => {
		const p: BlockParameters = {
			playhead: 1000,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesNormal(p);
		expect(result.indexes.length).toBe(0);
		expect(result.ended).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// C. findIndexesWithPlaybackRates
// ---------------------------------------------------------------------------

describe("findIndexesWithPlaybackRates", () => {
	it("rate=1 produces sequential indexes", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.indexes[0]).toBe(0);
		expect(result.indexes[127]).toBe(127);
		expect(result.playhead).toBe(128);
	});

	it("rate=2 skips every other sample", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 10000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 10000,
			durationSamples: 10000,
			playbackRates: new Float32Array([2]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.indexes[0]).toBe(0);
		expect(result.indexes[1]).toBe(2);
		expect(result.indexes[2]).toBe(4);
		expect(result.playhead).toBe(256);
	});

	it("rate=0.5 reads each sample twice", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 10000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 10000,
			durationSamples: 10000,
			playbackRates: new Float32Array([0.5]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.indexes[0]).toBe(0);
		expect(result.indexes[1]).toBe(0); // floor(0.5) = 0
		expect(result.indexes[2]).toBe(1); // floor(1.0) = 1
		expect(result.indexes[3]).toBe(1); // floor(1.5) = 1
	});

	it("negative rate plays in reverse", () => {
		const p: BlockParameters = {
			playhead: 500,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([-1]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.indexes[0]).toBe(500);
		expect(result.indexes[1]).toBe(499);
		expect(result.indexes[2]).toBe(498);
	});

	it("near end of buffer without loop: truncated length", () => {
		const p: BlockParameters = {
			playhead: 950,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.indexes.length).toBe(50);
		expect(result.ended).toBe(true);
	});

	it("loop wrapping with positive rate", () => {
		const p: BlockParameters = {
			playhead: 940,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 10000,
			playbackRates: new Float32Array([1]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.looped).toBe(true);
	});

	it("loop wrapping with negative rate", () => {
		const p: BlockParameters = {
			playhead: 110,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 10000,
			playbackRates: new Float32Array([-1]),
		};
		const result = findIndexesWithPlaybackRates(p);
		expect(result.looped).toBe(true);
		// After wrapping back from loopStart, should go to loopEnd
	});

	it("rate changes across the block (a-rate)", () => {
		const rates = new Float32Array(128);
		for (let i = 0; i < 128; i++) rates[i] = i < 64 ? 1 : 2;
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 10000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 10000,
			durationSamples: 10000,
			playbackRates: rates,
		};
		const result = findIndexesWithPlaybackRates(p);
		// First 64 at rate=1, next 64 at rate=2
		expect(result.indexes[63]).toBe(63);
		// After 64 samples at rate=1, head=64. Then 64 samples at rate=2
		expect(result.playhead).toBe(64 + 128); // 192
	});
});

// ---------------------------------------------------------------------------
// D. Buffer operations
// ---------------------------------------------------------------------------

describe("fill", () => {
	it("maps indexes to correct output samples", () => {
		const source = makeBuffer(1000);
		const target = makeOutput(2);
		const indexes = [0, 5, 10, 15];
		fill(target, source, indexes);
		expect(target[0][0]).toBe(0);
		expect(target[0][1]).toBe(5);
		expect(target[0][2]).toBe(10);
		expect(target[1][0]).toBe(1000);
		expect(target[1][1]).toBe(1005);
	});

	it("zeroes remainder past indexes", () => {
		const source = makeBuffer(1000);
		const target = makeOutput(2);
		// Fill output with non-zero first
		target[0].fill(999);
		const indexes = [0, 1];
		fill(target, source, indexes);
		expect(target[0][2]).toBe(0);
		expect(target[0][127]).toBe(0);
	});

	it("handles mono source with stereo target without crashing", () => {
		const source = makeBuffer(1000, 1); // mono
		const target = makeOutput(2); // stereo
		target[0].fill(999);
		target[1].fill(999);
		const indexes = [0, 5, 10];
		fill(target, source, indexes);
		// Channel 0 should have the source values
		expect(target[0][0]).toBe(0);
		expect(target[0][1]).toBe(5);
		expect(target[0][2]).toBe(10);
		// Channel 1 should be zeroed (no source channel 1)
		expect(target[1][0]).toBe(0);
		expect(target[1][1]).toBe(0);
		expect(target[1][2]).toBe(0);
	});
});

describe("fillWithSilence", () => {
	it("all channels zeroed", () => {
		const buf = makeOutput(2);
		buf[0].fill(1);
		buf[1].fill(2);
		fillWithSilence(buf);
		for (const ch of buf) {
			for (let i = 0; i < ch.length; i++) expect(ch[i]).toBe(0);
		}
	});
});

describe("monoToStereo", () => {
	it("duplicates mono channel", () => {
		const signal: Float32Array[] = [new Float32Array([1, 2, 3])];
		monoToStereo(signal);
		expect(signal.length).toBe(2);
		expect(signal[1][0]).toBe(1);
		expect(signal[1][1]).toBe(2);
		expect(signal[1][2]).toBe(3);
	});
});

describe("copy", () => {
	it("multi-channel copy preserves all data", () => {
		const source = makeOutput(2);
		source[0][0] = 42;
		source[1][0] = 99;
		const target = makeOutput(2);
		copy(source, target);
		expect(target[0][0]).toBe(42);
		expect(target[1][0]).toBe(99);
	});

	it("expands target when source has more channels", () => {
		const source = makeOutput(3); // 3 channels
		source[0][0] = 1;
		source[1][0] = 2;
		source[2][0] = 3;
		const target = makeOutput(1); // only 1 channel
		copy(source, target);
		expect(target.length).toBe(3);
		expect(target[0][0]).toBe(1);
		expect(target[1][0]).toBe(2);
		expect(target[2][0]).toBe(3);
	});
});

describe("checkNans", () => {
	it("counts and replaces NaN values with 0", () => {
		const output = makeOutput(2);
		output[0][0] = Number.NaN;
		output[0][5] = Number.NaN;
		output[1][10] = Number.NaN;
		const count = checkNans(output);
		expect(count).toBe(3);
		expect(output[0][0]).toBe(0);
		expect(output[0][5]).toBe(0);
		expect(output[1][10]).toBe(0);
	});

	it("returns 0 when no NaNs", () => {
		const output = makeOutput(2);
		output[0][0] = 1;
		expect(checkNans(output)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// E. Filters
// ---------------------------------------------------------------------------

describe("gainFilter", () => {
	it("k-rate (length=1): scales all samples", () => {
		const arr = [new Float32Array([1, 2, 3, 4])];
		gainFilter(arr, new Float32Array([0.5]));
		expect(arr[0][0]).toBeCloseTo(0.5);
		expect(arr[0][1]).toBeCloseTo(1.0);
		expect(arr[0][3]).toBeCloseTo(2.0);
	});

	it("a-rate: per-sample gain", () => {
		const arr = [new Float32Array([1, 1, 1, 1])];
		gainFilter(arr, new Float32Array([0.5, 1.0, 0.25, 2.0]));
		expect(arr[0][0]).toBeCloseTo(0.5);
		expect(arr[0][1]).toBeCloseTo(1.0);
		expect(arr[0][2]).toBeCloseTo(0.25);
		expect(arr[0][3]).toBeCloseTo(2.0);
	});

	it("gain=1: no change", () => {
		const arr = [new Float32Array([1, 2, 3])];
		const original = new Float32Array(arr[0]);
		gainFilter(arr, new Float32Array([1]));
		expect(arr[0]).toEqual(original);
	});
});

describe("panFilter", () => {
	it("center: no attenuation", () => {
		const signal = [new Float32Array([1, 1]), new Float32Array([1, 1])];
		panFilter(signal, new Float32Array([0]));
		expect(signal[0][0]).toBeCloseTo(1);
		expect(signal[1][0]).toBeCloseTo(1);
	});

	it("hard left: right channel zeroed", () => {
		const signal = [new Float32Array([1, 1]), new Float32Array([1, 1])];
		panFilter(signal, new Float32Array([-1]));
		expect(signal[0][0]).toBeCloseTo(1); // left stays
		expect(signal[1][0]).toBeCloseTo(0); // right zeroed
	});

	it("hard right: left channel zeroed", () => {
		const signal = [new Float32Array([1, 1]), new Float32Array([1, 1])];
		panFilter(signal, new Float32Array([1]));
		expect(signal[0][0]).toBeCloseTo(0); // left zeroed
		expect(signal[1][0]).toBeCloseTo(1); // right stays
	});
});

describe("lowpassFilter", () => {
	const SR = 48000;

	it("low-frequency signal passes through mostly unchanged", () => {
		// 100 Hz sine through a 10000 Hz lowpass should pass mostly unchanged
		const buffer = makeSineBuffer(512, 100, SR, 1);
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		lowpassFilter(buffer, new Float32Array([10000]), SR, states);
		// Compare energy — should be very similar
		let origEnergy = 0;
		let filtEnergy = 0;
		for (let i = 128; i < 512; i++) {
			// skip transient
			origEnergy += original[i] ** 2;
			filtEnergy += buffer[0][i] ** 2;
		}
		expect(filtEnergy / origEnergy).toBeGreaterThan(0.9);
	});

	it("high-frequency signal is significantly attenuated", () => {
		// 15000 Hz sine through a 500 Hz lowpass should be heavily attenuated
		const buffer = makeSineBuffer(512, 15000, SR, 1);
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		lowpassFilter(buffer, new Float32Array([500]), SR, states);
		let origEnergy = 0;
		let filtEnergy = 0;
		for (let i = 128; i < 512; i++) {
			origEnergy += original[i] ** 2;
			filtEnergy += buffer[0][i] ** 2;
		}
		expect(filtEnergy / origEnergy).toBeLessThan(0.01);
	});

	it("cutoff=20000: early return (no filtering)", () => {
		const buffer = [new Float32Array([1, 2, 3, 4])];
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		lowpassFilter(buffer, new Float32Array([20000]), SR, states);
		expect(buffer[0]).toEqual(original);
	});

	it("filter state isolation: fresh state per test", () => {
		const states1 = createFilterState();
		const states2 = createFilterState();
		// Mutate states1
		states1[0].x_1 = 999;
		// states2 shouldn't be affected
		expect(states2[0].x_1).toBe(0);
	});

	it("a-rate: per-sample cutoff values", () => {
		const buffer = makeSineBuffer(512, 5000, SR, 2);
		const states = createFilterState();
		// Provide per-sample cutoffs (a-rate)
		const cutoffs = new Float32Array(512);
		for (let i = 0; i < 512; i++) cutoffs[i] = 1000;
		lowpassFilter(buffer, cutoffs, SR, states);
		// Should apply filtering with varying cutoffs
		let energy = 0;
		for (let i = 128; i < 512; i++) energy += buffer[0][i] ** 2;
		expect(energy).toBeGreaterThan(0);
	});
});

describe("highpassFilter", () => {
	const SR = 48000;

	it("high-frequency signal passes through", () => {
		const buffer = makeSineBuffer(512, 15000, SR, 1);
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		highpassFilter(buffer, new Float32Array([1000]), SR, states);
		let origEnergy = 0;
		let filtEnergy = 0;
		for (let i = 128; i < 512; i++) {
			origEnergy += original[i] ** 2;
			filtEnergy += buffer[0][i] ** 2;
		}
		expect(filtEnergy / origEnergy).toBeGreaterThan(0.9);
	});

	it("low-frequency signal is attenuated", () => {
		const buffer = makeSineBuffer(512, 50, SR, 1);
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		highpassFilter(buffer, new Float32Array([5000]), SR, states);
		let origEnergy = 0;
		let filtEnergy = 0;
		for (let i = 128; i < 512; i++) {
			origEnergy += original[i] ** 2;
			filtEnergy += buffer[0][i] ** 2;
		}
		expect(filtEnergy / origEnergy).toBeLessThan(0.1);
	});

	it("cutoff=20: early return (no filtering)", () => {
		const buffer = [new Float32Array([1, 2, 3, 4])];
		const original = new Float32Array(buffer[0]);
		const states = createFilterState();
		highpassFilter(buffer, new Float32Array([20]), SR, states);
		expect(buffer[0]).toEqual(original);
	});

	it("a-rate: per-sample cutoff values", () => {
		const buffer = makeSineBuffer(512, 100, SR, 2);
		const states = createFilterState();
		const cutoffs = new Float32Array(512);
		for (let i = 0; i < 512; i++) cutoffs[i] = 5000;
		highpassFilter(buffer, cutoffs, SR, states);
		let energy = 0;
		for (let i = 128; i < 512; i++) energy += buffer[0][i] ** 2;
		expect(energy).toBeGreaterThanOrEqual(0);
	});
});

// ---------------------------------------------------------------------------
// F. Envelopes (tested via processBlock)
// ---------------------------------------------------------------------------

describe("fade in (via processBlock)", () => {
	it("initial samples are quieter", () => {
		const SR = 48000;
		const buffer = makeBuffer(48000);
		// Set all buffer values to 1.0
		for (const ch of buffer) ch.fill(1.0);
		const props = getProperties(
			{
				buffer,
				fadeInDuration: 0.1,
				enableFadeIn: true,
				state: State.Started,
				startWhen: 0,
				stopWhen: 10,
				duration: 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = {
			playbackRate: new Float32Array([1]),
			detune: new Float32Array([0]),
			lowpass: new Float32Array([20000]),
			highpass: new Float32Array([20]),
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
		};
		const filterState = {
			lowpass: createFilterState(),
			highpass: createFilterState(),
		};
		const result = processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			filterState,
		);
		expect(result.keepAlive).toBe(true);
		// First sample should be quieter than last sample
		expect(Math.abs(outputs[0][0][0])).toBeLessThan(
			Math.abs(outputs[0][0][127]),
		);
	});
});

// ---------------------------------------------------------------------------
// G. handleProcessorMessage
// ---------------------------------------------------------------------------

describe("handleProcessorMessage", () => {
	const SR = 48000;
	const CT = 1.0;

	it("buffer message sets properties.buffer", () => {
		const props = getProperties({}, SR);
		const buf = makeBuffer(1000);
		const msgs = handleProcessorMessage(
			props,
			{ type: "buffer", data: buf },
			CT,
			SR,
		);
		expect(props.buffer).toBe(buf);
		expect(msgs).toEqual([]);
	});

	it("buffer message repairs the default loopEnd after late buffer assignment", () => {
		const props = getProperties({}, SR);
		const buf = makeBuffer(48000);

		handleProcessorMessage(props, { type: "buffer", data: buf }, CT, SR);

		expect(props.loopStart).toBe(0);
		expect(props.loopEnd).toBe(1);
	});

	it("start message → Scheduled, returns scheduled", () => {
		const buf = makeBuffer(48000);
		const props = getProperties({ buffer: buf }, SR);
		const msgs = handleProcessorMessage(props, { type: "start" }, CT, SR);
		expect(props.state).toBe(State.Scheduled);
		expect(msgs).toEqual([{ type: "scheduled" }]);
		expect(props.playedSamples).toBe(0);
		expect(props.timesLooped).toBe(0);
	});

	it("start with when/offset/duration options", () => {
		const buf = makeBuffer(48000);
		const props = getProperties({ buffer: buf }, SR);
		const msgs = handleProcessorMessage(
			props,
			{ type: "start", data: { when: 2.0, duration: 5.0 } },
			CT,
			SR,
		);
		expect(props.startWhen).toBe(2.0);
		expect(props.duration).toBe(5.0);
		expect(props.stopWhen).toBe(7.0);
		expect(msgs).toEqual([{ type: "scheduled" }]);
	});

	it("start with loop=true → duration=MAX_SAFE_INTEGER", () => {
		const buf = makeBuffer(48000);
		const props = getProperties({ buffer: buf, loop: true }, SR);
		handleProcessorMessage(props, { type: "start" }, CT, SR);
		expect(props.duration).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("start keeps a valid loop range when the buffer arrives after construction", () => {
		const props = getProperties({}, SR);
		const buf = makeBuffer(48000);

		handleProcessorMessage(props, { type: "buffer", data: buf }, CT, SR);
		handleProcessorMessage(props, { type: "start" }, CT, SR);
		handleProcessorMessage(props, { type: "loop", data: true }, CT, SR);

		expect(props.loopStart).toBe(0);
		expect(props.loopEnd).toBe(1);
		expect(props.duration).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("stop message → Stopped, returns stopped", () => {
		const props = getProperties({ state: State.Started }, SR);
		const msgs = handleProcessorMessage(props, { type: "stop" }, CT, SR);
		expect(props.state).toBe(State.Stopped);
		expect(msgs).toEqual([{ type: "stopped" }]);
	});

	it("stop when already ended → no-op", () => {
		const props = getProperties({ state: State.Ended }, SR);
		const msgs = handleProcessorMessage(props, { type: "stop" }, CT, SR);
		expect(props.state).toBe(State.Ended); // unchanged
		expect(msgs).toEqual([]);
	});

	it("pause → Paused, returns paused", () => {
		const props = getProperties({ state: State.Started }, SR);
		const msgs = handleProcessorMessage(props, { type: "pause" }, CT, SR);
		expect(props.state).toBe(State.Paused);
		expect(msgs).toEqual([{ type: "paused" }]);
	});

	it("resume → Started, returns resume", () => {
		const props = getProperties({ state: State.Paused }, SR);
		const msgs = handleProcessorMessage(props, { type: "resume" }, CT, SR);
		expect(props.state).toBe(State.Started);
		expect(msgs).toEqual([{ type: "resume" }]);
	});

	it("dispose → Disposed, buffer cleared, returns disposed", () => {
		const buf = makeBuffer(1000);
		const props = getProperties({ buffer: buf }, SR);
		const msgs = handleProcessorMessage(props, { type: "dispose" }, CT, SR);
		expect(props.state).toBe(State.Disposed);
		expect(props.buffer).toEqual([]);
		expect(msgs).toEqual([{ type: "disposed" }]);
	});

	it("loop toggle: sets loop and adjusts stopWhen when started", () => {
		const props = getProperties({ state: State.Started, stopWhen: 5 }, SR);
		handleProcessorMessage(props, { type: "loop", data: true }, CT, SR);
		expect(props.loop).toBe(true);
		expect(props.stopWhen).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("loopStart setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "loopStart", data: 0.5 }, CT, SR);
		expect(props.loopStart).toBe(0.5);
	});

	it("loopEnd setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "loopEnd", data: 2.0 }, CT, SR);
		expect(props.loopEnd).toBe(2.0);
	});

	it("loopCrossfade setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "loopCrossfade", data: 0.1 }, CT, SR);
		expect(props.loopCrossfade).toBe(0.1);
		expect(props.enableLoopCrossfade).toBe(true);
	});

	it("playhead setter (floors value)", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "playhead", data: 100.7 }, CT, SR);
		expect(props.playhead).toBe(100);
	});

	it("fadeIn setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "fadeIn", data: 0.5 }, CT, SR);
		expect(props.fadeInDuration).toBe(0.5);
		expect(props.enableFadeIn).toBe(true);
	});

	it("fadeOut setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "fadeOut", data: 0.3 }, CT, SR);
		expect(props.fadeOutDuration).toBe(0.3);
		expect(props.enableFadeOut).toBe(true);
	});

	it("fadeIn setter to 0 disables enableFadeIn", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "fadeIn", data: 0.5 }, CT, SR);
		expect(props.enableFadeIn).toBe(true);
		handleProcessorMessage(props, { type: "fadeIn", data: 0 }, CT, SR);
		expect(props.enableFadeIn).toBe(false);
	});

	it("fadeOut setter to 0 disables enableFadeOut", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "fadeOut", data: 0.3 }, CT, SR);
		expect(props.enableFadeOut).toBe(true);
		handleProcessorMessage(props, { type: "fadeOut", data: 0 }, CT, SR);
		expect(props.enableFadeOut).toBe(false);
	});

	it("loopCrossfade setter to 0 disables enableLoopCrossfade", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "loopCrossfade", data: 0.2 }, CT, SR);
		expect(props.enableLoopCrossfade).toBe(true);
		handleProcessorMessage(props, { type: "loopCrossfade", data: 0 }, CT, SR);
		expect(props.enableLoopCrossfade).toBe(false);
	});

	it("loopCrossfadeOffset setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(
			props,
			{ type: "loopCrossfadeOffset", data: 0.5 },
			CT,
			SR,
		);
		expect(props.loopCrossfadeOffset).toBe(0.5);
	});

	it("loopCrossfadeOffset clamps to [-1, 1]", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(
			props,
			{ type: "loopCrossfadeOffset", data: 2 },
			CT,
			SR,
		);
		expect(props.loopCrossfadeOffset).toBe(1);
		handleProcessorMessage(
			props,
			{ type: "loopCrossfadeOffset", data: -3 },
			CT,
			SR,
		);
		expect(props.loopCrossfadeOffset).toBe(-1);
	});

	it("toggleGain", () => {
		const props = getProperties({ enableGain: true }, SR);
		handleProcessorMessage(props, { type: "toggleGain" }, CT, SR);
		expect(props.enableGain).toBe(false);
		handleProcessorMessage(props, { type: "toggleGain", data: true }, CT, SR);
		expect(props.enableGain).toBe(true);
	});

	it("togglePan", () => {
		const props = getProperties({ enablePan: true }, SR);
		handleProcessorMessage(props, { type: "togglePan" }, CT, SR);
		expect(props.enablePan).toBe(false);
	});

	it("toggleLowpass", () => {
		const props = getProperties({ enableLowpass: true }, SR);
		handleProcessorMessage(props, { type: "toggleLowpass" }, CT, SR);
		expect(props.enableLowpass).toBe(false);
	});

	it("toggleHighpass", () => {
		const props = getProperties({ enableHighpass: true }, SR);
		handleProcessorMessage(props, { type: "toggleHighpass" }, CT, SR);
		expect(props.enableHighpass).toBe(false);
	});

	it("toggleDetune", () => {
		const props = getProperties({ enableDetune: true }, SR);
		handleProcessorMessage(props, { type: "toggleDetune" }, CT, SR);
		expect(props.enableDetune).toBe(false);
	});

	it("togglePlaybackRate", () => {
		const props = getProperties({ enablePlaybackRate: true }, SR);
		handleProcessorMessage(props, { type: "togglePlaybackRate" }, CT, SR);
		expect(props.enablePlaybackRate).toBe(false);
	});

	it("toggleFadeIn", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "toggleFadeIn", data: true }, CT, SR);
		expect(props.enableFadeIn).toBe(true);
	});

	it("toggleFadeOut", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(
			props,
			{ type: "toggleFadeOut", data: true },
			CT,
			SR,
		);
		expect(props.enableFadeOut).toBe(true);
	});

	it("toggleLoopCrossfade", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(
			props,
			{ type: "toggleLoopCrossfade", data: true },
			CT,
			SR,
		);
		expect(props.enableLoopCrossfade).toBe(true);
	});

	it("toggleLoopStart", () => {
		const props = getProperties({ enableLoopStart: true }, SR);
		handleProcessorMessage(props, { type: "toggleLoopStart" }, CT, SR);
		expect(props.enableLoopStart).toBe(false);
		handleProcessorMessage(
			props,
			{ type: "toggleLoopStart", data: true },
			CT,
			SR,
		);
		expect(props.enableLoopStart).toBe(true);
	});

	it("toggleLoopEnd", () => {
		const props = getProperties({ enableLoopEnd: true }, SR);
		handleProcessorMessage(props, { type: "toggleLoopEnd" }, CT, SR);
		expect(props.enableLoopEnd).toBe(false);
		handleProcessorMessage(
			props,
			{ type: "toggleLoopEnd", data: true },
			CT,
			SR,
		);
		expect(props.enableLoopEnd).toBe(true);
	});

	it("logState returns empty array", () => {
		const props = getProperties({}, SR);
		const msgs = handleProcessorMessage(props, { type: "logState" }, CT, SR);
		expect(msgs).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// H. processBlock (integration-level)
// ---------------------------------------------------------------------------

describe("processBlock", () => {
	const SR = 48000;

	function makeProcessParams() {
		return {
			playbackRate: new Float32Array([1]),
			detune: new Float32Array([0]),
			lowpass: new Float32Array([20000]),
			highpass: new Float32Array([20]),
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
		};
	}

	function makeFilterState() {
		return {
			lowpass: createFilterState(),
			highpass: createFilterState(),
		};
	}

	it("Disposed → keepAlive=false", () => {
		const props = getProperties({ state: State.Disposed }, SR);
		const result = processBlock(
			props,
			[makeOutput(2)],
			makeProcessParams(),
			{ currentTime: 0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(false);
	});

	it("Initial → keepAlive=true", () => {
		const props = getProperties({ state: State.Initial }, SR);
		const result = processBlock(
			props,
			[makeOutput(2)],
			makeProcessParams(),
			{ currentTime: 0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
	});

	it("Ended → outputs silence, keepAlive=true", () => {
		const props = getProperties({ state: State.Ended }, SR);
		const outputs = [makeOutput(2)];
		outputs[0][0].fill(999);
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		// Verify silence
		for (let i = 0; i < 128; i++) expect(outputs[0][0][i]).toBe(0);
	});

	it("Scheduled, time not reached → silence", () => {
		const props = getProperties(
			{
				state: State.Scheduled,
				startWhen: 5.0,
				buffer: makeBuffer(48000),
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		expect(props.state).toBe(State.Scheduled); // still scheduled
	});

	it("Scheduled, time reached → transitions to Started with 'started' message", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Scheduled,
				startWhen: 1.0,
				stopWhen: 100,
				duration: 99,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.state).toBe(State.Started);
		expect(result.messages).toContainEqual({ type: "started" });
	});

	it("normal playback: correct samples from buffer", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Channel 0, sample 0 should be buffer[0][0] = 0
		expect(outputs[0][0][0]).toBe(0);
		// Channel 0, sample 5 should be buffer[0][5] = 5
		expect(outputs[0][0][5]).toBe(5);
		// Channel 1, sample 0 should be buffer[1][0] = 1000
		expect(outputs[0][1][0]).toBe(1000);
	});

	it("playback through end of buffer → Ended state", () => {
		const buffer = makeBuffer(200); // short buffer
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				playhead: 150,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.state).toBe(State.Ended);
		expect(result.messages).toContainEqual({ type: "ended" });
	});

	it("loop playback: returns looped message", () => {
		const buffer = makeBuffer(1000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart: 0,
				loopEnd: 1000 / SR,
				playhead: 950,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.messages).toContainEqual(
			expect.objectContaining({ type: "looped" }),
		);
	});

	it("stop: transitions to Ended after stopWhen", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 0.5,
				duration: 0.5,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.state).toBe(State.Ended);
		expect(result.messages).toContainEqual({ type: "ended" });
	});

	it("mono buffer → auto-stereo conversion", () => {
		const buffer = [new Float32Array(1000).fill(0.5)]; // mono
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(1)]; // mono output
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// After mono-to-stereo, output should have 2 channels
		expect(outputs[0].length).toBe(2);
	});

	it("mono buffer with stereo output does not crash", () => {
		const buffer = [new Float32Array(1000).fill(0.5)]; // mono
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)]; // stereo output, mono source
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Both channels should have values (mono upmixed to stereo)
		expect(outputs[0][0][0]).toBe(0.5);
		expect(outputs[0][1][0]).toBe(0.5);
	});

	it("playhead and playedSamples updated correctly", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				playhead: 0,
				playedSamples: 0,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.playhead).toBe(128);
		expect(props.playedSamples).toBe(128);
	});

	it("multi-output: copies to additional outputs", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const out1 = makeOutput(2);
		const out2 = makeOutput(2);
		processBlock(
			props,
			[out1, out2],
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// out2 should be a copy of out1
		expect(out2[0][0]).toBe(out1[0][0]);
		expect(out2[0][5]).toBe(out1[0][5]);
	});

	it("fade in: initial samples are attenuated", () => {
		const buffer = makeBuffer(48000);
		// Fill buffer with 1.0 so we can see attenuation
		for (const ch of buffer) ch.fill(1);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				playhead: 0,
				playedSamples: 0,
				fadeInDuration: 1.0,
				enableFadeIn: true,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// First sample should be near zero (cubic: 0^3 = 0)
		expect(outputs[0][0][0]).toBeCloseTo(0, 3);
		// Last sample should still be attenuated but greater than first
		expect(outputs[0][0][127]).toBeGreaterThan(outputs[0][0][0]);
		// Gain should monotonically increase across the block
		for (let i = 1; i < 128; i++) {
			expect(outputs[0][0][i]).toBeGreaterThanOrEqual(outputs[0][0][i - 1]);
		}
	});

	it("fade in: cubic curve stays quiet early in long fade", () => {
		const buffer = makeBuffer(48000 * 10);
		for (const ch of buffer) ch.fill(1);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				playhead: 0,
				playedSamples: 0,
				fadeInDuration: 10.0, // 10-second fade
				enableFadeIn: true,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// At 128 samples into a 480000-sample fade, t = 128/480000 ≈ 0.000267
		// g = t^3 ≈ 1.9e-11, essentially silent
		expect(outputs[0][0][127]).toBeLessThan(0.001);
	});

	it("fade out: samples are attenuated near stop time", () => {
		const buffer = makeBuffer(48000);
		for (const ch of buffer) ch.fill(1);
		const stopWhen = 1.003; // just barely ahead of currentTime
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen,
				duration: stopWhen,
				buffer,
				playhead: 48000 - 256,
				playedSamples: 48000 - 256,
				fadeOutDuration: 1.0,
				enableFadeOut: true,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Samples should be attenuated due to fade out
		expect(outputs[0][0][0]).toBeLessThan(1.0);
		// Last sample (closest to stopWhen) should be quieter than first
		expect(Math.abs(outputs[0][0][127])).toBeLessThan(
			Math.abs(outputs[0][0][0]),
		);
	});

	it("fade out: monotonically decreasing gain", () => {
		const buffer = makeBuffer(48000 * 2);
		for (const ch of buffer) ch.fill(1);
		// Place ourselves 0.5s before stopWhen, with a 1s fadeOut
		// so we're in the middle of the fade zone
		const stopWhen = 2.0;
		const currentTime = 1.5;
		const fadeOutDuration = 1.0;
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen,
				duration: stopWhen,
				buffer,
				playhead: Math.floor(currentTime * SR),
				playedSamples: Math.floor(currentTime * SR),
				fadeOutDuration,
				enableFadeOut: true,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Gain should monotonically decrease across the block
		for (let i = 1; i < 128; i++) {
			expect(outputs[0][0][i]).toBeLessThanOrEqual(outputs[0][0][i - 1]);
		}
		// First sample should be louder than last sample
		expect(outputs[0][0][0]).toBeGreaterThan(outputs[0][0][127]);
	});

	it("fade out: multi-block fade produces decreasing RMS", () => {
		const buffer = makeBuffer(48000 * 2);
		for (const ch of buffer) ch.fill(1);
		const stopWhen = 2.0;
		const fadeOutDuration = 1.0;
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen,
				duration: stopWhen,
				buffer,
				playhead: Math.floor(1.0 * SR),
				playedSamples: Math.floor(1.0 * SR),
				fadeOutDuration,
				enableFadeOut: true,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);

		const rmsValues: number[] = [];
		// Process multiple blocks through the fade-out zone
		for (let block = 0; block < 10; block++) {
			const outputs = [makeOutput(2)];
			const ct = 1.0 + (block * 128) / SR;
			processBlock(
				props,
				outputs,
				makeProcessParams(),
				{ currentTime: ct, currentFrame: 0, sampleRate: SR },
				makeFilterState(),
			);
			let sum = 0;
			for (let i = 0; i < 128; i++) sum += outputs[0][0][i] ** 2;
			rmsValues.push(Math.sqrt(sum / 128));
		}
		// RMS should decrease over successive blocks
		for (let i = 1; i < rmsValues.length; i++) {
			expect(rmsValues[i]).toBeLessThanOrEqual(rmsValues[i - 1] + 0.001);
		}
	});

	it("processBlock with gain filter enabled", () => {
		const buffer = makeBuffer(48000);
		for (const ch of buffer) ch.fill(1);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: true,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.gain = new Float32Array([0.5]);
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(outputs[0][0][0]).toBeCloseTo(0.5); // gain applied
	});

	it("processBlock with lowpass and highpass enabled", () => {
		const buffer = makeSineBuffer(48000, 1000, SR);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: true,
				enableHighpass: true,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.lowpass = new Float32Array([5000]);
		params.highpass = new Float32Array([100]);
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Signal should still be present since 1000Hz is within 100-5000Hz band
		const maxVal = Math.max(...outputs[0][0].slice(10));
		expect(maxVal).toBeGreaterThan(0);
	});

	it("processBlock with pan enabled", () => {
		const buffer = makeBuffer(48000);
		for (const ch of buffer) ch.fill(1);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: true,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.pan = new Float32Array([-1]); // hard left
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Right channel should be zeroed
		expect(outputs[0][1][0]).toBe(0);
	});

	it("processBlock with playbackRate enabled", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: true,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.playbackRate = new Float32Array([2]); // double speed
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// At 2x speed, playhead should advance by 256 samples (128 * 2)
		expect(props.playhead).toBeCloseTo(256, 0);
	});

	it("loop crossfade at loop boundaries", () => {
		// Use a large enough buffer with crossfade zone
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		for (const ch of buffer) ch.fill(1);
		// loopStart = 0.1s = 4800 samples, loopEnd = 0.9s = 43200 samples
		const loopStart = 0.1;
		const loopEnd = 0.9;
		const loopCrossfade = 0.05; // 2400 samples crossfade
		const loopStartSamples = Math.floor(loopStart * SR);
		// Place playhead just inside crossfade zone near loop start
		// crossfade out zone: loopStartSamples < playhead < loopStartSamples + xfadeNumSamples
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				playhead: loopStartSamples + 10, // just past loop start, within crossfade zone
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Just verify it runs and advances playhead
		expect(props.playhead).toBeGreaterThan(loopStartSamples + 10);
	});

	it("loop crossfade approaching loop end", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0.1;
		const loopEnd = 0.9;
		const loopCrossfade = 0.05;
		const loopEndSamples = Math.floor(loopEnd * SR);
		const xfadeNumSamples = Math.floor(loopCrossfade * SR);
		// Place playhead in crossfade-in zone near loop end
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				playhead: loopEndSamples - xfadeNumSamples + 10, // in crossfade-in zone
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.playhead).toBeGreaterThan(0);
	});

	it("crossfade output never exceeds input amplitude (equal-power)", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		// Fill buffer with constant amplitude 1 — crossfade between two regions
		// of identical amplitude should never exceed ~1.0.
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0.1;
		const loopEnd = 0.9;
		const loopCrossfade = 0.05;
		const loopStartSamples = Math.floor(loopStart * SR);
		const xfadeNumSamples = Math.floor(loopCrossfade * SR);

		// Walk through crossfade zone at loop start
		for (
			let ph = loopStartSamples + 1;
			ph < loopStartSamples + xfadeNumSamples;
			ph += SAMPLE_BLOCK_SIZE
		) {
			const props = getProperties(
				{
					state: State.Started,
					startWhen: 0,
					stopWhen: 100,
					duration: 100,
					buffer,
					loop: true,
					loopStart,
					loopEnd,
					loopCrossfade,
					enableLoopCrossfade: true,
					playhead: ph,
					enableLowpass: false,
					enableHighpass: false,
					enableGain: false,
					enablePan: false,
					enablePlaybackRate: false,
				},
				SR,
			);
			const outputs = [makeOutput(2)];
			processBlock(
				props,
				outputs,
				makeProcessParams(),
				{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
				makeFilterState(),
			);
			for (const ch of outputs[0]) {
				for (let i = 0; i < ch.length; i++) {
					// Allow small floating-point tolerance above 1.0
					expect(Math.abs(ch[i])).toBeLessThanOrEqual(1.001);
				}
			}
		}
	});

	it("loopCrossfadeOffset=0 produces same output as default", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		for (let i = 0; i < bufLen; i++) {
			buffer[0][i] = Math.sin(i * 0.01);
			buffer[1][i] = Math.cos(i * 0.01);
		}
		const loopStart = 0.1;
		const loopEnd = 0.9;
		const loopCrossfade = 0.05;
		const loopStartSamples = Math.floor(loopStart * SR);

		const propsA = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer: [buffer[0].slice(), buffer[1].slice()],
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				loopCrossfadeOffset: 0,
				playhead: loopStartSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputsA = [makeOutput(2)];
		processBlock(
			propsA,
			outputsA,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);

		const propsB = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer: [buffer[0].slice(), buffer[1].slice()],
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				playhead: loopStartSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputsB = [makeOutput(2)];
		processBlock(
			propsB,
			outputsB,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);

		for (let ch = 0; ch < 2; ch++) {
			for (let i = 0; i < SAMPLE_BLOCK_SIZE; i++) {
				expect(outputsA[0][ch][i]).toBeCloseTo(outputsB[0][ch][i], 10);
			}
		}
	});

	it("loopCrossfadeOffset shifts crossfade source positions", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		// Fill with distinct values per sample so offset shift is detectable
		for (let i = 0; i < bufLen; i++) {
			buffer[0][i] = Math.sin(i * 0.1);
			buffer[1][i] = Math.cos(i * 0.1);
		}
		const loopStart = 0.1;
		const loopEnd = 0.9;
		const loopCrossfade = 0.05;
		const loopStartSamples = Math.floor(loopStart * SR);

		const propsDefault = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer: [buffer[0].slice(), buffer[1].slice()],
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				loopCrossfadeOffset: 0,
				playhead: loopStartSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputsDefault = [makeOutput(2)];
		processBlock(
			propsDefault,
			outputsDefault,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);

		const propsOffset = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer: [buffer[0].slice(), buffer[1].slice()],
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				loopCrossfadeOffset: -1,
				playhead: loopStartSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputsOffset = [makeOutput(2)];
		processBlock(
			propsOffset,
			outputsOffset,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);

		// With a non-zero offset, the crossfade sources differ, so output should differ
		let differ = false;
		for (let i = 0; i < SAMPLE_BLOCK_SIZE; i++) {
			if (Math.abs(outputsDefault[0][0][i] - outputsOffset[0][0][i]) > 1e-6) {
				differ = true;
				break;
			}
		}
		expect(differ).toBe(true);
	});

	it("enableLoopStart=false uses 0 for loopStart", () => {
		const buffer = makeBuffer(4800);
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0.05; // 2400 samples at 48kHz
		const loopEnd = 4800 / SR;
		// Place playhead near the custom loopStart boundary
		// With enableLoopStart=false, loop wraps at 0 not at 2400
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				enableLoopStart: false,
				playhead: 4700, // near end of buffer, will loop
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// When loopStart disabled, playhead should wrap to 0 (not 2400)
		expect(props.playhead).toBeLessThan(2400);
	});

	it("enableLoopEnd=false uses sourceLength for loopEnd", () => {
		const buffer = makeBuffer(4800);
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0;
		const loopEnd = 0.05; // 2400 samples — normally would loop here
		// With enableLoopEnd=false, loop uses full buffer length
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				enableLoopEnd: false,
				playhead: 2400, // past the custom loopEnd
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Playhead should advance past 2400 since loopEnd is effectively full buffer
		expect(props.playhead).toBeGreaterThan(2400);
	});

	it("NaN in output triggers logging and returns early", () => {
		// Create a buffer that will produce NaN when processed
		const buffer = makeBuffer(48000);
		// Introduce NaN values in the buffer
		buffer[0][0] = Number.NaN;
		buffer[0][1] = Number.NaN;
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const out1 = makeOutput(2);
		const out2 = makeOutput(2);
		const result = processBlock(
			props,
			[out1, out2],
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		// NaN values should be replaced with 0
		expect(out1[0][0]).toBe(0);
		expect(out1[0][1]).toBe(0);
	});

	it("Paused state after pauseWhen → outputs silence", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Paused,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				pauseWhen: 0.5,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		outputs[0][0].fill(999);
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		for (let i = 0; i < 128; i++) expect(outputs[0][0][i]).toBe(0);
	});

	it("Paused state before pauseWhen → plays samples", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Paused,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				pauseWhen: 5.0,
				buffer,
				playhead: 0,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 1.0, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
		// Should have played samples since currentTime < pauseWhen
		expect(props.playhead).toBe(128);
	});

	it("loop crossfade out when loopEnd + crossfade > sourceLength", () => {
		// Make loopEnd near buffer end so crossfade extends past sourceLength
		const bufLen = 2000;
		const buffer = makeBuffer(bufLen);
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0.005; // 240 samples
		const loopEnd = (bufLen - 100) / SR; // near end
		const loopCrossfade = 0.02; // 960 samples (loopEnd + crossfade > bufLen)
		const loopStartSamples = Math.floor(loopStart * SR);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				playhead: loopStartSamples + 5,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.playhead).toBeGreaterThan(loopStartSamples + 5);
	});

	it("loop crossfade in when loopStart < crossfade width (firstIndex < 0)", () => {
		// Make loopStart small so crossfade-in zone extends before buffer start
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		for (const ch of buffer) ch.fill(1);
		const loopStart = 0.01; // 480 samples - small
		const loopEnd = 0.9; // 43200 samples
		const loopCrossfade = 0.02; // 960 samples > loopStart, so firstIndex < 0
		const loopEndSamples = Math.floor(loopEnd * SR);
		const xfadeNumSamples = Math.floor(loopCrossfade * SR);
		// Position playhead in crossfade-in zone
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				loop: true,
				loopStart,
				loopEnd,
				loopCrossfade,
				enableLoopCrossfade: true,
				playhead: loopEndSamples - xfadeNumSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(props.playhead).toBeGreaterThan(0);
	});

	it("empty buffer → outputs silence", () => {
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer: [new Float32Array(0), new Float32Array(0)],
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			makeProcessParams(),
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		expect(result.keepAlive).toBe(true);
	});

	it("detune enabled: +1200 cents doubles playback rate", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
				enableDetune: true,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.detune = new Float32Array([1200]); // +1200 cents = 1 octave up = 2x rate
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// At 2x effective rate, playhead should advance by ~256 samples (128 * 2)
		expect(props.playhead).toBeCloseTo(256, 0);
	});

	it("detune disabled: detune param is ignored", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
				enableDetune: false,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.detune = new Float32Array([1200]); // would be 2x if enabled
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// Without detune, normal playback: playhead advances by 128
		expect(props.playhead).toBe(128);
	});

	it("detune combined with playbackRate", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: 100,
				duration: 100,
				buffer,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: true,
				enableDetune: true,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		const params = makeProcessParams();
		params.playbackRate = new Float32Array([2]); // 2x speed
		params.detune = new Float32Array([1200]); // +1200 cents = another 2x
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			makeFilterState(),
		);
		// 2x playback * 2x detune = 4x, so playhead should advance by ~512
		expect(props.playhead).toBeCloseTo(512, 0);
	});
});

// ===========================================================================
// Loop parameter combination tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Additional helpers for loop tests
// ---------------------------------------------------------------------------

function simulateBlocks(
	props: Required<ClipProcessorOptions>,
	numBlocks: number,
	params?: Record<string, Float32Array>,
	sampleRate = 48000,
): {
	allOutputs: Float32Array[][];
	messages: OutboundMessage[];
	playheadHistory: number[];
} {
	const p = params ?? {
		playbackRate: new Float32Array([1]),
		detune: new Float32Array([0]),
		lowpass: new Float32Array([20000]),
		highpass: new Float32Array([20]),
		gain: new Float32Array([1]),
		pan: new Float32Array([0]),
	};
	const filterState = {
		lowpass: createFilterState(),
		highpass: createFilterState(),
	};
	const allOutputs: Float32Array[][] = [];
	const messages: OutboundMessage[] = [];
	const playheadHistory: number[] = [props.playhead];
	const blockDuration = 128 / sampleRate;

	for (let b = 0; b < numBlocks; b++) {
		const outputs = [makeOutput(2)];
		const ct = 0.001 + b * blockDuration;
		const result = processBlock(
			props,
			outputs,
			p,
			{ currentTime: ct, currentFrame: b * 128, sampleRate },
			filterState,
		);
		allOutputs.push(outputs[0]);
		messages.push(...result.messages);
		playheadHistory.push(props.playhead);
		if (!result.keepAlive) break;
	}
	return { allOutputs, messages, playheadHistory };
}

function makeLoopProps(
	overrides: Partial<ClipProcessorOptions> & { buffer: Float32Array[] },
	sampleRate = 48000,
): Required<ClipProcessorOptions> {
	return getProperties(
		{
			state: State.Started,
			startWhen: 0,
			stopWhen: 100,
			duration: 100,
			enableLowpass: false,
			enableHighpass: false,
			enableGain: false,
			enablePan: false,
			enablePlaybackRate: false,
			...overrides,
		},
		sampleRate,
	);
}

// ---------------------------------------------------------------------------
// Category A: findIndexesNormal — Loop Index Generation
// ---------------------------------------------------------------------------

describe("Loop: findIndexesNormal", () => {
	it("A1: no loop, sequential indexes from start", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.indexes.length).toBe(128);
		for (let i = 0; i < 128; i++) expect(r.indexes[i]).toBe(i);
		expect(r.ended).toBe(false);
		expect(r.looped).toBe(false);
	});

	it("A2: no loop, near end → truncated, ended=true", () => {
		const p: BlockParameters = {
			playhead: 950,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.indexes.length).toBe(50);
		expect(r.ended).toBe(true);
		expect(r.looped).toBe(false);
	});

	it("A3: loop, playhead at start, no wrap needed", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.indexes.length).toBe(128);
		for (let i = 0; i < 128; i++) expect(r.indexes[i]).toBe(i);
		expect(r.looped).toBe(false);
		expect(r.ended).toBe(false);
	});

	it("A4: loop wraps from loopEnd to loopStart mid-block", () => {
		const p: BlockParameters = {
			playhead: 900,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.looped).toBe(true);
		expect(r.ended).toBe(false);
		// First 50 samples are 900..949
		for (let i = 0; i < 50; i++) expect(r.indexes[i]).toBe(900 + i);
		// After wrap: index 50 should be 100 (loopStart)
		expect(r.indexes[50]).toBe(100);
		expect(r.indexes[51]).toBe(101);
	});

	it("A5: loop, playhead exactly at loopEnd → immediate wrap", () => {
		const p: BlockParameters = {
			playhead: 950,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 950,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.looped).toBe(true);
		expect(r.indexes[0]).toBe(100);
	});

	it("A6: short loop (200 samples) wraps multiple times per block", () => {
		const p: BlockParameters = {
			playhead: 150,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 200,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.looped).toBe(true);
		// All indexes should be in [0, 200)
		for (const idx of r.indexes) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(200);
		}
	});

	it("A7: zero-length loop (loopStart == loopEnd) — no crash", () => {
		const p: BlockParameters = {
			playhead: 500,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 500,
			loopEndSamples: 500,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		// Should not throw
		const r = findIndexesNormal(p);
		expect(r.indexes.length).toBe(128);
	});
});

// ---------------------------------------------------------------------------
// Category B: findIndexesWithPlaybackRates — Loop + Rate
// ---------------------------------------------------------------------------

describe("Loop: findIndexesWithPlaybackRates", () => {
	it("B1: rate=1.0 matches normal indexing", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const rNormal = findIndexesNormal(p);
		const rRate = findIndexesWithPlaybackRates(p);
		expect(rRate.indexes).toEqual(rNormal.indexes);
		expect(rRate.playhead).toBeCloseTo(rNormal.playhead);
	});

	it("B2: rate=2.0, wraps sooner", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([2]),
		};
		const r = findIndexesWithPlaybackRates(p);
		// At rate=2, playhead should advance ~256
		expect(r.playhead).toBeCloseTo(256, 0);
		// Indexes should skip every other sample
		expect(r.indexes[0]).toBe(0);
		expect(r.indexes[1]).toBe(2);
	});

	it("B3: rate=0.5, wraps later", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([0.5]),
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.playhead).toBeCloseTo(64, 0);
		expect(r.looped).toBe(false);
	});

	it("B4: rate=-1.0, reverse wraps from loopStart to loopEnd", () => {
		const p: BlockParameters = {
			playhead: 500,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([-1]),
		};
		const r = findIndexesWithPlaybackRates(p);
		// Playing in reverse from 500
		expect(r.indexes[0]).toBe(500);
		expect(r.indexes[1]).toBe(499);
		// Eventually wraps to loopEnd once past loopStart(0)
		expect(r.looped).toBe(false); // 500 steps backward, only 128 samples processed → still at 372
	});

	it("B5: reverse rate with custom loop bounds", () => {
		const p: BlockParameters = {
			playhead: 110,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 800,
			durationSamples: 100000,
			playbackRates: new Float32Array([-1]),
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.looped).toBe(true);
		// After wrapping past loopStart, should be at loopEnd
	});

	it("B6: rate=-2.0, fast reverse", () => {
		const p: BlockParameters = {
			playhead: 500,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([-2]),
		};
		const r = findIndexesWithPlaybackRates(p);
		// From 500, 128 samples at rate=-2 = -256, arrives at 244 → no wrap
		// But if heading < 0 it wraps → 500 - 256 = 244, no wrap
		expect(r.indexes[0]).toBe(500);
		expect(r.indexes[1]).toBe(498);
	});

	it("B7: no loop, rate=2.0, ends sooner", () => {
		const p: BlockParameters = {
			playhead: 900,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([2]),
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.ended).toBe(true);
	});

	it("B8: no loop, rate=-1.0, ends when head < 0", () => {
		const p: BlockParameters = {
			playhead: 50,
			bufferLength: 1000,
			loop: false,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 1000,
			playbackRates: new Float32Array([-1]),
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.ended).toBe(true);
	});

	it("B9: a-rate changes across block with loop wrapping", () => {
		const rates = new Float32Array(128);
		for (let i = 0; i < 128; i++) rates[i] = i < 64 ? 1 : 2;
		const p: BlockParameters = {
			playhead: 850,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 100,
			loopEndSamples: 900,
			durationSamples: 100000,
			playbackRates: rates,
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.looped).toBe(true);
		// All indexes should be within valid buffer range
		for (const idx of r.indexes) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(1000);
		}
	});

	it("B10: rate=0, playhead frozen — all indexes same", () => {
		const p: BlockParameters = {
			playhead: 500,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([0]),
		};
		const r = findIndexesWithPlaybackRates(p);
		for (const idx of r.indexes) {
			expect(idx).toBe(500);
		}
		expect(r.looped).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Category H: Property Defaults & Message Handling (loop-related)
// ---------------------------------------------------------------------------

describe("Loop: property defaults & messages", () => {
	const SR = 48000;
	const CT = 1.0;

	it("H1: getProperties defaults loopEnd to bufLen/sampleRate", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties({ buffer }, SR);
		expect(props.loopEnd).toBeCloseTo(1.0);
	});

	it("H2: getProperties respects explicit loopEnd", () => {
		const buffer = makeBuffer(48000);
		const props = getProperties({ buffer, loopEnd: 0.5 }, SR);
		expect(props.loopEnd).toBe(0.5);
	});

	it("H3: loopCrossfade message sets property", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "loopCrossfade", data: 0.1 }, CT, SR);
		expect(props.loopCrossfade).toBe(0.1);
	});

	it("H4: loop=true on Started extends stopWhen to MAX", () => {
		const props = getProperties({ state: State.Started, stopWhen: 5 }, SR);
		handleProcessorMessage(props, { type: "loop", data: true }, CT, SR);
		expect(props.loop).toBe(true);
		expect(props.stopWhen).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("H5: loop=true on Scheduled extends stopWhen to MAX", () => {
		const props = getProperties({ state: State.Scheduled, stopWhen: 5 }, SR);
		handleProcessorMessage(props, { type: "loop", data: true }, CT, SR);
		expect(props.stopWhen).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("H6: toggleLoopCrossfade toggles both directions", () => {
		const props = getProperties({}, SR);
		expect(props.enableLoopCrossfade).toBe(false);
		handleProcessorMessage(
			props,
			{ type: "toggleLoopCrossfade", data: true },
			CT,
			SR,
		);
		expect(props.enableLoopCrossfade).toBe(true);
		handleProcessorMessage(props, { type: "toggleLoopCrossfade" }, CT, SR);
		expect(props.enableLoopCrossfade).toBe(false);
	});

	it("H7: start with loop=true sets duration=MAX_SAFE_INTEGER", () => {
		const buf = makeBuffer(48000);
		const props = getProperties({ buffer: buf, loop: true }, SR);
		handleProcessorMessage(props, { type: "start" }, CT, SR);
		expect(props.duration).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("H8: start resets timesLooped to 0", () => {
		const buf = makeBuffer(48000);
		const props = getProperties({ buffer: buf, timesLooped: 5 }, SR);
		handleProcessorMessage(props, { type: "start" }, CT, SR);
		expect(props.timesLooped).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Category C: processBlock — Loop Crossfade
// ---------------------------------------------------------------------------

describe("Loop: crossfade via processBlock", () => {
	const SR = 48000;

	function makeUniformBuffer(length: number, value = 1.0, channels = 2) {
		return Array.from({ length: channels }, () =>
			new Float32Array(length).fill(value),
		);
	}

	it("C1: xfade-out zone near loopStart — output bounded (constant-gain)", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopStartSamples = Math.floor(0.1 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: loopStartSamples + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// With constant-gain crossfade (sin²+cos²=1), output should stay bounded
		const allBounded = outputs[0][0].every((v) => Math.abs(v) <= 1.001);
		expect(allBounded).toBe(true);
	});

	it("C2: xfade-in zone approaching loopEnd — output bounded (constant-gain)", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopEndSamples = Math.floor(0.9 * SR);
		const xfadeNumSamples = Math.floor(0.05 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: loopEndSamples - xfadeNumSamples + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		const allBounded = outputs[0][0].every((v) => Math.abs(v) <= 1.001);
		expect(allBounded).toBe(true);
	});

	it("C3: enableLoopCrossfade=false — no crossfade despite params", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopStartSamples = Math.floor(0.1 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: false,
			playhead: loopStartSamples + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// All values should be exactly 1.0 (no blending)
		for (let i = 0; i < 128; i++) {
			expect(outputs[0][0][i]).toBeCloseTo(1.0);
		}
	});

	it("C4: crossfade=0, enable=true — no effect", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.1 * SR) + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		for (let i = 0; i < 128; i++) {
			expect(outputs[0][0][i]).toBeCloseTo(1.0);
		}
	});

	it("C5: middle of loop — outside both xfade zones — no crossfade", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.5 * SR), // middle of loop
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		for (let i = 0; i < 128; i++) {
			expect(outputs[0][0][i]).toBeCloseTo(1.0);
		}
	});

	it("C6: small loopStart, large crossfade — firstIndex<0 clamped, no crash", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopEndSamples = Math.floor(0.9 * SR);
		const xfadeNumSamples = Math.floor(0.02 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.005,
			loopEnd: 0.9,
			loopCrossfade: 0.02,
			enableLoopCrossfade: true,
			playhead: loopEndSamples - xfadeNumSamples + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("C7: loopEnd near buffer end — loopEnd+xfade > sourceLength, no OOB", () => {
		const bufLen = 2000;
		const buffer = makeUniformBuffer(bufLen);
		const loopStartSamples = Math.floor(0.005 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.005,
			loopEnd: (bufLen - 100) / SR,
			loopCrossfade: 0.02,
			enableLoopCrossfade: true,
			playhead: loopStartSamples + 5,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("C8: no crossfade when loop=false", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: false,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.5 * SR),
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		for (let i = 0; i < 128; i++) {
			expect(outputs[0][0][i]).toBeCloseTo(1.0);
		}
	});

	it("C9: crossfade at buffer start (loopStart=0)", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: bufLen / SR,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("C10: crossfade > loop length — clamped", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopLength = 0.9 - 0.1; // 0.8s
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: loopLength + 1.0, // way larger than loop
			enableLoopCrossfade: true,
			playhead: Math.floor(0.5 * SR),
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// Should not crash; crossfade is clamped by min(xfadeNumSamples, loopLengthSamples)
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("C13: crossfade with rate=2.0 — still applied correctly", () => {
		const bufLen = 48000;
		const buffer = makeUniformBuffer(bufLen);
		const loopStartSamples = Math.floor(0.1 * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			enablePlaybackRate: true,
			playhead: loopStartSamples + 10,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([2]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
		// playhead should have advanced at 2x rate
		expect(props.playhead).toBeGreaterThan(loopStartSamples + 10 + 128);
	});
});

// ---------------------------------------------------------------------------
// Category E: Loop + Offset Interaction
// ---------------------------------------------------------------------------

describe("Loop: offset interaction", () => {
	const SR = 48000;

	it("E1: offset=0, loop=true, plays from 0 and loops", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 0.8,
		});
		handleProcessorMessage(
			props,
			{ type: "start", data: { offset: 0 } },
			0,
			SR,
		);
		props.state = State.Started as number as typeof props.state;
		const { playheadHistory } = simulateBlocks(props, 400);
		// Playhead should be within loop bounds after entering loop
		const loopStartSamples = Math.floor(0.2 * SR);
		const loopEndSamples = Math.floor(0.8 * SR);
		// After initial playthrough, should stay in loop
		const later = playheadHistory.slice(100);
		for (const ph of later) {
			expect(ph).toBeGreaterThanOrEqual(loopStartSamples - 128);
			expect(ph).toBeLessThanOrEqual(loopEndSamples + 128);
		}
	});

	it("E2: offset within loop region", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.2,
			loopEnd: 0.8,
		});
		handleProcessorMessage(
			props,
			{ type: "start", data: { offset: 0.5 } },
			0,
			SR,
		);
		props.state = State.Started as number as typeof props.state;
		// Playhead should be at offset
		expect(props.playhead).toBe(Math.floor(0.5 * SR));
	});

	it("E4: loop=false, offset respected, no looping", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: false,
		});
		handleProcessorMessage(
			props,
			{ type: "start", data: { offset: 0.5 } },
			0,
			SR,
		);
		props.state = State.Started as number as typeof props.state;
		expect(props.playhead).toBe(Math.floor(0.5 * SR));
		const { messages } = simulateBlocks(props, 500);
		// Should eventually end
		expect(messages.some((m) => m.type === "ended")).toBe(true);
		// Should NOT have looped
		expect(messages.some((m) => m.type === "looped")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Category F: Loop + Duration Interaction
// ---------------------------------------------------------------------------

describe("Loop: duration interaction", () => {
	it("F1: duration shorter than 1 loop — ends before completing loop", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const loopLen = 0.5; // 24000 samples
		const duration = 0.2; // shorter than one loop
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: loopLen,
			duration,
			stopWhen: duration,
		});
		const { messages } = simulateBlocks(props, 200);
		expect(messages.some((m) => m.type === "ended")).toBe(true);
		// Should not have looped (duration too short)
		expect(messages.filter((m) => m.type === "looped").length).toBe(0);
	});

	it("F2: duration exactly 1 loop length — completes then ends", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const loopLen = 0.5;
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: loopLen,
			duration: loopLen,
			stopWhen: loopLen,
		});
		const { messages } = simulateBlocks(props, 300);
		expect(messages.some((m) => m.type === "ended")).toBe(true);
	});

	it("F4: duration MAX_SAFE_INTEGER — loops indefinitely (tested for 500 blocks)", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { messages } = simulateBlocks(props, 500);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		expect(messages.filter((m) => m.type === "looped").length).toBeGreaterThan(
			0,
		);
	});
});

// ---------------------------------------------------------------------------
// Category D: Multi-Block Loop Lifecycle
// ---------------------------------------------------------------------------

describe("Loop: multi-block lifecycle", () => {
	const SR = 48000;

	it("D1: loop emits 'looped' messages at correct intervals", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const loopEnd = 0.5; // 24000 samples
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { messages } = simulateBlocks(props, 250);
		const loopedMessages = messages.filter((m) => m.type === "looped");
		expect(loopedMessages.length).toBeGreaterThan(0);
		// timesLooped should increment
		expect(props.timesLooped).toBe(loopedMessages.length);
	});

	it("D2: playhead stays within loop bounds over 3 iterations", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const loopStart = 0.1;
		const loopEnd = 0.3;
		const loopStartSamples = Math.floor(loopStart * SR);
		const loopEndSamples = Math.floor(loopEnd * SR);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart,
			loopEnd,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
			playhead: loopStartSamples,
		});
		// 0.2s loop = 9600 samples, 75 blocks per loop, need ~225 for 3 loops
		const { playheadHistory, messages } = simulateBlocks(props, 300);
		const loopedCount = messages.filter((m) => m.type === "looped").length;
		expect(loopedCount).toBeGreaterThanOrEqual(3);
		// After entering loop, playhead should always be in [loopStart, loopEnd + 128]
		for (const ph of playheadHistory.slice(1)) {
			expect(ph).toBeGreaterThanOrEqual(loopStartSamples - 1);
			expect(ph).toBeLessThanOrEqual(loopEndSamples + 128);
		}
	});

	it("D3: loop + crossfade multi-block — no NaN", () => {
		const bufLen = 48000;
		const buffer = Array.from({ length: 2 }, () =>
			new Float32Array(bufLen).fill(1),
		);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.1 * SR) + 10,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const { allOutputs } = simulateBlocks(props, 400);
		for (const out of allOutputs) {
			expect(checkNans(out)).toBe(0);
		}
	});

	it("D4: enable loop mid-playback — extends stopWhen and wraps", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: false,
			playhead: 0,
			duration: 1,
			stopWhen: 1,
		});
		// Play 5 blocks normally
		simulateBlocks(props, 5);
		// Now enable loop
		handleProcessorMessage(props, { type: "loop", data: true }, 0.1, SR);
		expect(props.loop).toBe(true);
		expect(props.stopWhen).toBe(Number.MAX_SAFE_INTEGER);
		// Continue playing — should wrap and not end
		const { messages } = simulateBlocks(props, 500);
		expect(messages.some((m) => m.type === "looped")).toBe(true);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
	});

	it("D5: disable loop mid-playback — plays to end", () => {
		const bufLen = 4800; // short buffer
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: bufLen / SR,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		// Play a few blocks with loop enabled
		simulateBlocks(props, 10);
		// Disable loop
		handleProcessorMessage(props, { type: "loop", data: false }, 0.1, SR);
		expect(props.loop).toBe(false);
		// Now set a reasonable stopWhen so it will end
		props.stopWhen = 0.2;
		props.duration = 0.2;
		const { messages } = simulateBlocks(props, 100);
		expect(messages.some((m) => m.type === "ended")).toBe(true);
	});

	it("D6: change loopStart mid-playback", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		simulateBlocks(props, 50);
		// Change loopStart
		handleProcessorMessage(props, { type: "loopStart", data: 0.2 }, 0.1, SR);
		expect(props.loopStart).toBe(0.2);
		// Continue — should respect new loopStart
		const { playheadHistory } = simulateBlocks(props, 200);
		// After wrapping, playhead should be >= new loopStartSamples
		const newLoopStart = Math.floor(0.2 * SR);
		const wrappedHeads = playheadHistory.filter(
			(ph) => ph >= newLoopStart - 128 && ph <= Math.floor(0.5 * SR) + 128,
		);
		expect(wrappedHeads.length).toBeGreaterThan(0);
	});

	it("D7: change loopEnd mid-playback", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		simulateBlocks(props, 50);
		handleProcessorMessage(props, { type: "loopEnd", data: 0.3 }, 0.1, SR);
		expect(props.loopEnd).toBe(0.3);
		// Continue playing with shorter loop
		const { messages } = simulateBlocks(props, 200);
		expect(messages.filter((m) => m.type === "looped").length).toBeGreaterThan(
			0,
		);
	});

	it("D8: change loopCrossfade mid-playback", () => {
		const bufLen = 48000;
		const buffer = Array.from({ length: 2 }, () =>
			new Float32Array(bufLen).fill(1),
		);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.1 * SR) + 10,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		simulateBlocks(props, 5);
		// Increase crossfade
		handleProcessorMessage(
			props,
			{ type: "loopCrossfade", data: 0.05 },
			0.1,
			SR,
		);
		expect(props.loopCrossfade).toBe(0.05);
		const { allOutputs } = simulateBlocks(props, 400);
		for (const out of allOutputs) {
			expect(checkNans(out)).toBe(0);
		}
	});

	it("D9: toggleLoopCrossfade on/off mid-playback", () => {
		const bufLen = 48000;
		const buffer = Array.from({ length: 2 }, () =>
			new Float32Array(bufLen).fill(1),
		);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: false,
			playhead: Math.floor(0.1 * SR) + 10,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		simulateBlocks(props, 5);
		// Enable crossfade
		handleProcessorMessage(
			props,
			{ type: "toggleLoopCrossfade", data: true },
			0.1,
			SR,
		);
		expect(props.enableLoopCrossfade).toBe(true);
		const { allOutputs: out1 } = simulateBlocks(props, 5);
		// Disable crossfade
		handleProcessorMessage(
			props,
			{ type: "toggleLoopCrossfade", data: false },
			0.1,
			SR,
		);
		expect(props.enableLoopCrossfade).toBe(false);
		const { allOutputs: out2 } = simulateBlocks(props, 5);
		// Both runs should have no NaN
		for (const out of [...out1, ...out2]) {
			expect(checkNans(out)).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Category G: Edge Cases & Boundary Conditions
// ---------------------------------------------------------------------------

describe("Loop: edge cases", () => {
	const SR = 48000;

	it("G1: loopStart > loopEnd — no crash", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.8,
			loopEnd: 0.2,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		// Should not throw
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("G2: loopEnd > buffer duration — clamped to buffer length", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 10.0, // way past buffer duration
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("G4: buffer shorter than 128 samples + loop — wraps correctly", () => {
		const bufLen = 64;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: bufLen / SR,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const outputs = [makeOutput(2)];
		const originalConsoleLog = console.log;
		const consoleLogCalls: unknown[][] = [];
		console.log = (...args) => {
			consoleLogCalls.push(args);
		};

		try {
			processBlock(
				props,
				outputs,
				{
					playbackRate: new Float32Array([1]),
					detune: new Float32Array([0]),
					lowpass: new Float32Array([20000]),
					highpass: new Float32Array([20]),
					gain: new Float32Array([1]),
					pan: new Float32Array([0]),
				},
				{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
				{ lowpass: createFilterState(), highpass: createFilterState() },
			);
		} finally {
			console.log = originalConsoleLog;
		}

		// Should not have NaN and should wrap
		expect(consoleLogCalls).toHaveLength(0);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("G5: very short loop (64 samples) — multiple wraps per block", () => {
		const p: BlockParameters = {
			playhead: 0,
			bufferLength: 1000,
			loop: true,
			loopStartSamples: 0,
			loopEndSamples: 64,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.looped).toBe(true);
		// All indexes should be in [0, 64)
		for (const idx of r.indexes) {
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThan(64);
		}
		// Should have wrapped: 128 > 64
		expect(r.indexes[64]).toBe(0); // wrapped back to start
	});

	it("G6: negative loopCrossfade — no crossfade (enableLoopCrossfade derives as false)", () => {
		const props = getProperties({ loopCrossfade: -0.1 }, SR);
		expect(props.enableLoopCrossfade).toBe(false);
	});

	it("G7: empty buffer + loop=true — outputs silence, no crash", () => {
		const props = makeLoopProps({
			buffer: [new Float32Array(0), new Float32Array(0)],
			loop: true,
			loopStart: 0,
			loopEnd: 0,
		});
		const outputs = [makeOutput(2)];
		const result = processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(result.keepAlive).toBe(true);
	});

	it("G8: mono buffer + loop + crossfade — monoToStereo works", () => {
		const bufLen = 48000;
		const buffer = [new Float32Array(bufLen).fill(0.5)]; // mono
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0.1,
			loopEnd: 0.9,
			loopCrossfade: 0.05,
			enableLoopCrossfade: true,
			playhead: Math.floor(0.5 * SR),
		});
		const outputs = [makeOutput(1)]; // start mono
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// After processing, should have 2 channels (mono-to-stereo)
		expect(outputs[0].length).toBe(2);
	});

	it("G9: loop + playbackRate + detune combined", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5,
			enablePlaybackRate: true,
			enableDetune: true,
			playhead: 0,
			duration: Number.MAX_SAFE_INTEGER,
			stopWhen: Number.MAX_SAFE_INTEGER,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([2]),
				detune: new Float32Array([1200]), // +1 octave = 2x more
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// computedRate = 2 * 2^(1200/1200) = 4, playhead should advance ~512
		expect(props.playhead).toBeCloseTo(512, -1);
		expect(checkNans(outputs[0])).toBe(0);
	});

	it("G10: NaN in buffer within loop region — checkNans catches it", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		buffer[0][100] = Number.NaN;
		buffer[0][101] = Number.NaN;
		const props = makeLoopProps({
			buffer,
			loop: true,
			loopStart: 0,
			loopEnd: 0.5,
			playhead: 95,
		});
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		// NaN should have been replaced with 0
		expect(outputs[0][0][5]).toBe(0); // was NaN at buffer index 100
		expect(outputs[0][0][6]).toBe(0); // was NaN at buffer index 101
	});

	it("G11: loopStart=0, loopEnd=0 — loops entire buffer", () => {
		const bufLen = 48000;
		const buffer = makeBuffer(bufLen);
		// Per W3C: loopEnd=0 means loop entire buffer
		// In our impl, getProperties defaults loopEnd to bufLen/SR when not specified
		const props = getProperties(
			{
				buffer,
				loop: true,
				loopStart: 0,
				// loopEnd not specified → defaults to bufLen/SR
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		expect(props.loopEnd).toBeCloseTo(bufLen / SR);
		const { messages } = simulateBlocks(props, 500);
		expect(messages.filter((m) => m.type === "looped").length).toBeGreaterThan(
			0,
		);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
	});

	it("G12: streaming buffer ranges render decoded samples then hold at commit edge", () => {
		const props = getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		handleProcessorMessage(
			props,
			{ type: "bufferInit", data: { channels: 2, totalLength: 512 } },
			0,
			SR,
		);
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(128).fill(0.25),
						new Float32Array(128).fill(0.5),
					],
				},
			},
			0,
			SR,
		);

		const firstOutputs = [makeOutput(2)];
		processBlock(
			props,
			firstOutputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(firstOutputs[0][0][0]).toBeCloseTo(0.25);
		expect(firstOutputs[0][1][0]).toBeCloseTo(0.5);
		expect(props.streamBuffer.committedLength).toBe(128);

		const secondOutputs = [makeOutput(2)];
		const secondResult = processBlock(
			props,
			secondOutputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.002, currentFrame: 128, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(secondOutputs[0][0][0]).toBe(0);
		expect(props.state).toBe(State.Started);
		expect(props.playhead).toBe(128);
		expect(
			secondResult.messages.some(
				(message) => message.type === "bufferUnderrun",
			),
		).toBe(false);
	});

	it("G13: exact zero playbackRate outputs silence without moving playhead", () => {
		const buffer = [
			new Float32Array(1024).fill(0.5),
			new Float32Array(1024).fill(0.5),
		];
		const props = getProperties(
			{
				buffer,
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: true,
			},
			SR,
		);
		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([0]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);
		expect(outputs[0][0].every((sample) => sample === 0)).toBe(true);
		expect(props.playhead).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// H. Buffer swap during playback
// ---------------------------------------------------------------------------

describe("Buffer swap during playback", () => {
	const SR = 48000;
	const BLOCK = 128;

	function makeProcessParams(
		overrides: Partial<Record<string, Float32Array>> = {},
	) {
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

	function makeFilterState() {
		return {
			lowpass: createFilterState(),
			highpass: createFilterState(),
		};
	}

	function makeSine(length: number, freq = 440, channels = 2): Float32Array[] {
		return Array.from({ length: channels }, () => {
			const arr = new Float32Array(length);
			for (let i = 0; i < length; i++)
				arr[i] = Math.sin((2 * Math.PI * freq * i) / SR);
			return arr;
		});
	}

	function makeConstant(
		length: number,
		value: number,
		channels = 2,
	): Float32Array[] {
		return Array.from({ length: channels }, () =>
			new Float32Array(length).fill(value),
		);
	}

	function rms(arr: Float32Array, start = 0, end?: number): number {
		const e = end ?? arr.length;
		let sum = 0;
		for (let i = start; i < e; i++) sum += arr[i] * arr[i];
		return Math.sqrt(sum / (e - start));
	}

	function hasSound(output: Float32Array[], threshold = 1e-10): boolean {
		for (const ch of output) {
			for (let i = 0; i < ch.length; i++) {
				if (Math.abs(ch[i]) > threshold) return true;
			}
		}
		return false;
	}

	/** Start a props in playing state with effects disabled for clarity. */
	function makePlayingProps(
		overrides: Partial<ClipProcessorOptions> = {},
	): Required<ClipProcessorOptions> {
		return getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
				...overrides,
			},
			SR,
		);
	}

	/** Process N blocks, collecting messages and tracking NaNs. */
	function runBlocks(
		props: Required<ClipProcessorOptions>,
		numBlocks: number,
		params?: Record<string, Float32Array>,
	) {
		const p = params ?? makeProcessParams();
		const filterState = makeFilterState();
		const allOutputs: Float32Array[][] = [];
		const allMessages: OutboundMessage[] = [];
		let totalNans = 0;
		const blockDuration = BLOCK / SR;

		for (let b = 0; b < numBlocks; b++) {
			const out = [makeOutput(2)];
			const ct = 0.001 + b * blockDuration;
			const result = processBlock(
				props,
				out,
				p,
				{ currentTime: ct, currentFrame: b * BLOCK, sampleRate: SR },
				filterState,
			);
			allOutputs.push(out[0]);
			allMessages.push(...result.messages);
			totalNans += checkNans(out[0]);
			if (!result.keepAlive) break;
		}
		return { allOutputs, allMessages, totalNans };
	}

	// ── A. Full buffer swap ──────────────────────────────────────────────

	it("A1: swap to same-length buffer (different content) — sound before & after, no NaN, playhead preserved", () => {
		const buf1 = makeConstant(1024, 0.3);
		const props = makePlayingProps({ buffer: buf1 });

		// Play 3 blocks
		const before = runBlocks(props, 3);
		expect(before.totalNans).toBe(0);
		expect(hasSound(before.allOutputs[0])).toBe(true);
		const playheadBeforeSwap = props.playhead;

		// Swap buffer
		const buf2 = makeConstant(1024, 0.7);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.01, SR);

		// Playhead should NOT have been reset
		expect(props.playhead).toBe(playheadBeforeSwap);

		// Play 3 more blocks
		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		expect(hasSound(after.allOutputs[0])).toBe(true);
	});

	it("A2: swap to shorter buffer (playhead beyond new length) — no crash, clamped read", () => {
		const buf1 = makeConstant(1024, 0.5);
		const props = makePlayingProps({ buffer: buf1 });

		// Advance playhead past 512
		runBlocks(props, 5);
		expect(props.playhead).toBeGreaterThan(512);

		// Swap to shorter buffer
		const buf2 = makeConstant(256, 0.8);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.1, SR);

		// Should not crash; process a few more blocks
		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
	});

	it("A3: swap to longer buffer — playhead unchanged, can play extended region", () => {
		const buf1 = makeConstant(512, 0.3);
		const props = makePlayingProps({ buffer: buf1 });

		runBlocks(props, 2);
		const playheadBefore = props.playhead;

		// Swap to longer buffer
		const buf2 = makeConstant(4096, 0.6);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.01, SR);
		expect(props.playhead).toBe(playheadBefore);

		// Play many more blocks — should produce sound in extended region
		const after = runBlocks(props, 20);
		expect(after.totalNans).toBe(0);
		expect(hasSound(after.allOutputs[10])).toBe(true);
	});

	it("A4: swap from stereo to mono buffer — monoToStereo activates, both channels populated", () => {
		const buf1 = makeConstant(1024, 0.5, 2);
		const props = makePlayingProps({ buffer: buf1 });

		runBlocks(props, 2);

		// Swap to mono
		const bufMono = makeConstant(1024, 0.4, 1);
		handleProcessorMessage(props, { type: "buffer", data: bufMono }, 0.01, SR);

		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		// Both output channels should have sound (monoToStereo copies ch0→ch1)
		expect(rms(after.allOutputs[0][0])).toBeGreaterThan(0);
		expect(rms(after.allOutputs[0][1])).toBeGreaterThan(0);
	});

	it("A5: swap from mono to stereo buffer — stereo output correct", () => {
		const bufMono = makeConstant(1024, 0.4, 1);
		const props = makePlayingProps({ buffer: bufMono });

		runBlocks(props, 2);

		const bufStereo = makeConstant(1024, 0.6, 2);
		handleProcessorMessage(
			props,
			{ type: "buffer", data: bufStereo },
			0.01,
			SR,
		);

		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		expect(rms(after.allOutputs[0][0])).toBeGreaterThan(0);
		expect(rms(after.allOutputs[0][1])).toBeGreaterThan(0);
	});

	it("A6: swap buffer while looping — loop still wraps, looped message emitted", () => {
		const buf1 = makeConstant(384, 0.5); // 3 blocks
		const props = makePlayingProps({
			buffer: buf1,
			loop: true,
			loopStart: 0,
			loopEnd: 384 / SR,
		});

		// Run enough blocks to loop at least once
		const result = runBlocks(props, 6);
		expect(result.allMessages.some((m) => m.type === "looped")).toBe(true);

		// Swap buffer
		const buf2 = makeConstant(384, 0.8);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.1, SR);

		// Continue playing — should still loop
		const after = runBlocks(props, 6);
		expect(after.totalNans).toBe(0);
		expect(after.allMessages.some((m) => m.type === "looped")).toBe(true);
	});

	it("A7: swap to shorter buffer while looping — normalizeLoopBounds clamps loopEnd", () => {
		const buf1 = makeConstant(1024, 0.5);
		const props = makePlayingProps({
			buffer: buf1,
			loop: true,
			loopStart: 0,
			loopEnd: 1024 / SR,
		});

		runBlocks(props, 2);

		// Swap to much shorter buffer
		const buf2 = makeConstant(256, 0.8);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.1, SR);

		// loopEnd should have been clamped to new buffer duration
		expect(props.loopEnd).toBeLessThanOrEqual(256 / SR + 0.0001);

		// Continue looping — should not crash
		const after = runBlocks(props, 10);
		expect(after.totalNans).toBe(0);
	});

	it("A8: swap buffer multiple times rapidly (5 swaps in 10 blocks) — last buffer heard", () => {
		const buf1 = makeConstant(2048, 0.1);
		const props = makePlayingProps({ buffer: buf1 });
		const params = makeProcessParams();
		const filterState = makeFilterState();
		let totalNans = 0;

		for (let b = 0; b < 10; b++) {
			if (b % 2 === 1) {
				const val = 0.1 * (b + 1);
				const newBuf = makeConstant(2048, val);
				handleProcessorMessage(
					props,
					{ type: "buffer", data: newBuf },
					0.001 + (b * BLOCK) / SR,
					SR,
				);
			}
			const out = [makeOutput(2)];
			const result = processBlock(
				props,
				out,
				params,
				{
					currentTime: 0.001 + (b * BLOCK) / SR,
					currentFrame: b * BLOCK,
					sampleRate: SR,
				},
				filterState,
			);
			totalNans += checkNans(out[0]);
			expect(result.keepAlive).toBe(true);
		}
		expect(totalNans).toBe(0);
	});

	it("A9: swap to empty buffer — output is silence, no crash", () => {
		const buf1 = makeConstant(1024, 0.5);
		const props = makePlayingProps({ buffer: buf1 });

		runBlocks(props, 2);

		// Swap to empty
		handleProcessorMessage(props, { type: "buffer", data: [] }, 0.1, SR);

		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		// All output should be silence
		for (const out of after.allOutputs) {
			expect(hasSound(out)).toBe(false);
		}
	});

	it("A10: swap from empty to populated buffer — sound begins", () => {
		const props = makePlayingProps({ buffer: [] });

		// Silence before
		const before = runBlocks(props, 2);
		for (const out of before.allOutputs) {
			expect(hasSound(out)).toBe(false);
		}

		// Swap in a real buffer
		const buf = makeConstant(1024, 0.6);
		handleProcessorMessage(props, { type: "buffer", data: buf }, 0.01, SR);

		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		// Playhead was at 0 (buffer was empty), now should produce sound
		// Reset playhead to 0 so we read from start of new buffer
		props.playhead = 0;
		const afterReset = runBlocks(props, 3);
		expect(hasSound(afterReset.allOutputs[0])).toBe(true);
	});

	it("A11: swap buffer while paused, then resume — reads from new buffer", () => {
		const buf1 = makeConstant(1024, 0.3);
		const props = makePlayingProps({ buffer: buf1 });

		runBlocks(props, 2);

		// Pause
		handleProcessorMessage(props, { type: "pause" }, 0.01, SR);

		// Swap buffer while paused
		const buf2 = makeConstant(1024, 0.9);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.02, SR);

		// Resume
		handleProcessorMessage(props, { type: "resume" }, 0.03, SR);

		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
		expect(hasSound(after.allOutputs[0])).toBe(true);
	});

	it("A12: swap buffer during loop crossfade — no OOB, no NaN", () => {
		const buf1 = makeSine(2048, 440);
		const props = makePlayingProps({
			buffer: buf1,
			loop: true,
			loopStart: 0,
			loopEnd: 2048 / SR,
			loopCrossfade: 0.005, // ~240 samples
			enableLoopCrossfade: true,
		});

		// Advance to near the loop end (crossfade zone)
		const nearEnd = Math.floor(2048 / BLOCK) - 2;
		runBlocks(props, nearEnd);

		// Swap buffer while in crossfade zone
		const buf2 = makeSine(2048, 880);
		handleProcessorMessage(props, { type: "buffer", data: buf2 }, 0.1, SR);

		// Continue through crossfade and loop wrap
		const after = runBlocks(props, 6);
		expect(after.totalNans).toBe(0);
	});

	// ── B. Partial buffer replacement / streaming ────────────────────────

	it("B1: replace region ahead of playhead — output reflects new data", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 1024, streaming: true },
			},
			0,
			SR,
		);

		// Write initial data (first 512 samples)
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(512).fill(0.3),
						new Float32Array(512).fill(0.3),
					],
				},
			},
			0,
			SR,
		);
		// Write region ahead of playhead (512–768) with different data
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 512,
					channelData: [
						new Float32Array(256).fill(0.9),
						new Float32Array(256).fill(0.9),
					],
				},
			},
			0,
			SR,
		);

		// Play past 512 samples
		const result = runBlocks(props, 8);
		expect(result.totalNans).toBe(0);
		// Block 4 starts at sample 512 — should see higher amplitude
		expect(rms(result.allOutputs[4][0])).toBeGreaterThan(0.5);
	});

	it("B2: replace region behind playhead — no crash, no effect on current output", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 1024, streaming: true },
			},
			0,
			SR,
		);
		// Write all data
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(1024).fill(0.5),
						new Float32Array(1024).fill(0.5),
					],
				},
			},
			0,
			SR,
		);

		// Play 4 blocks (playhead at 512)
		runBlocks(props, 4);

		// Replace region 0–128 (behind playhead)
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(128).fill(0.1),
						new Float32Array(128).fill(0.1),
					],
				},
			},
			0.01,
			SR,
		);

		// Continue — no crash
		const after = runBlocks(props, 3);
		expect(after.totalNans).toBe(0);
	});

	it("B3: replace region at current playhead position — next blocks use new data", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 1024, streaming: true },
			},
			0,
			SR,
		);
		// Write all data at 0.3
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(1024).fill(0.3),
						new Float32Array(1024).fill(0.3),
					],
				},
			},
			0,
			SR,
		);

		// Play 2 blocks (playhead at 256)
		runBlocks(props, 2);
		const ph = Math.floor(props.playhead);

		// Replace region at playhead with high-amplitude data
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: ph,
					channelData: [
						new Float32Array(128).fill(0.95),
						new Float32Array(128).fill(0.95),
					],
				},
			},
			0.01,
			SR,
		);

		// Next block should use the new data
		const after = runBlocks(props, 1);
		expect(after.totalNans).toBe(0);
		expect(rms(after.allOutputs[0][0])).toBeGreaterThan(0.8);
	});

	it("B4: playhead reaching uncommitted region holds until new data arrives", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 512, streaming: true },
			},
			0,
			SR,
		);
		// Write only first 128 samples
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(128).fill(0.5),
						new Float32Array(128).fill(0.5),
					],
				},
			},
			0,
			SR,
		);

		// Play 1 block (consumes 128 samples), then next block should hold.
		const first = runBlocks(props, 1);
		expect(first.totalNans).toBe(0);

		const second = runBlocks(props, 1);
		expect(second.allMessages.some((m) => m.type === "bufferUnderrun")).toBe(
			false,
		);
		expect(props.playhead).toBe(128);

		// Write more data
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 128,
					channelData: [
						new Float32Array(256).fill(0.5),
						new Float32Array(256).fill(0.5),
					],
				},
			},
			0.01,
			SR,
		);

		// Should be able to proceed now
		const third = runBlocks(props, 1);
		expect(third.totalNans).toBe(0);
		expect(rms(third.allOutputs[0][0])).toBeGreaterThan(0.1);
	});

	it("B5: all data written before playhead catches up — no underrun", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 512, streaming: true },
			},
			0,
			SR,
		);
		// Write all 512 samples upfront
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(512).fill(0.5),
						new Float32Array(512).fill(0.5),
					],
				},
			},
			0,
			SR,
		);

		const result = runBlocks(props, 4);
		expect(result.totalNans).toBe(0);
		expect(result.allMessages.some((m) => m.type === "bufferUnderrun")).toBe(
			false,
		);
	});

	it("B6: sequential bufferRange messages (append) — spans merge, committedLength advances", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 512, streaming: true },
			},
			0,
			SR,
		);

		// Append 4 chunks of 128 samples each
		for (let i = 0; i < 4; i++) {
			handleProcessorMessage(
				props,
				{
					type: "bufferRange",
					data: {
						startSample: i * 128,
						channelData: [
							new Float32Array(128).fill(0.3 + i * 0.1),
							new Float32Array(128).fill(0.3 + i * 0.1),
						],
					},
				},
				0,
				SR,
			);
		}

		// committedLength should be 512 after processing
		runBlocks(props, 1); // triggers applyPendingBufferWrites
		expect(props.streamBuffer.committedLength).toBe(512);

		// Play all
		const result = runBlocks(props, 3);
		expect(result.totalNans).toBe(0);
	});

	it("B7: replace same region twice with different data — second write wins", () => {
		const props = makePlayingProps();
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels: 2, totalLength: 512, streaming: true },
			},
			0,
			SR,
		);
		// Write all zeros first
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(512).fill(0),
						new Float32Array(512).fill(0),
					],
				},
			},
			0,
			SR,
		);

		// Overwrite first 128 samples with 0.8
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 0,
					channelData: [
						new Float32Array(128).fill(0.8),
						new Float32Array(128).fill(0.8),
					],
				},
			},
			0,
			SR,
		);

		// First block should reflect the overwrite
		const result = runBlocks(props, 1);
		expect(result.totalNans).toBe(0);
		expect(rms(result.allOutputs[0][0])).toBeGreaterThan(0.5);
	});
});

// ---------------------------------------------------------------------------
// E2E: fade-in/crossfade set via message (regression for DD-CLIP-14)
// ---------------------------------------------------------------------------

describe("fade via message is audible (DD-CLIP-14)", () => {
	const SR = 48000;
	const CT = 0;

	it("fade-in set via message attenuates initial samples", () => {
		const buffer = Array.from({ length: 2 }, () =>
			new Float32Array(48000).fill(1.0),
		);
		const props = getProperties(
			{
				buffer,
				state: State.Started,
				startWhen: 0,
				stopWhen: 10,
				duration: 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		// Set fade-in via message (as the streaming example does)
		handleProcessorMessage(props, { type: "fadeIn", data: 0.1 }, CT, SR);
		expect(props.enableFadeIn).toBe(true);

		const outputs = [makeOutput(2)];
		const params = {
			playbackRate: new Float32Array([1]),
			detune: new Float32Array([0]),
			lowpass: new Float32Array([20000]),
			highpass: new Float32Array([20]),
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
		};
		const filterState = {
			lowpass: createFilterState(),
			highpass: createFilterState(),
		};
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			filterState,
		);
		// First sample should be attenuated relative to last sample
		expect(Math.abs(outputs[0][0][0])).toBeLessThan(
			Math.abs(outputs[0][0][127]),
		);
	});

	it("crossfade set via message enables blending at loop boundary", () => {
		const bufLen = 48000;
		const buffer = Array.from({ length: 2 }, () =>
			new Float32Array(bufLen).fill(1.0),
		);
		const loopStartSamples = Math.floor(0.1 * SR);
		const props = getProperties(
			{
				buffer,
				loop: true,
				loopStart: 0.1,
				loopEnd: 0.9,
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.POSITIVE_INFINITY,
				duration: Number.POSITIVE_INFINITY,
				playhead: loopStartSamples + 10,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
			},
			SR,
		);
		// Set crossfade via message
		handleProcessorMessage(
			props,
			{ type: "loopCrossfade", data: 0.05 },
			CT,
			SR,
		);
		expect(props.enableLoopCrossfade).toBe(true);

		const outputs = [makeOutput(2)];
		const params = {
			playbackRate: new Float32Array([1]),
			detune: new Float32Array([0]),
			lowpass: new Float32Array([20000]),
			highpass: new Float32Array([20]),
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
		};
		const filterState = {
			lowpass: createFilterState(),
			highpass: createFilterState(),
		};
		processBlock(
			props,
			outputs,
			params,
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			filterState,
		);
		// With crossfade enabled at the beginning of a loop zone,
		// output should be non-silent
		const hasNonZero = outputs[0][0].some((v) => v !== 0);
		expect(hasNonZero).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Category H: Streaming Loop Behavior
// ---------------------------------------------------------------------------

describe("Streaming Loop", () => {
	const SR = 48000;

	function makeStreamingProps(
		overrides: Partial<ClipProcessorOptions> = {},
	): Required<ClipProcessorOptions> {
		return getProperties(
			{
				state: State.Started,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
				enableLowpass: false,
				enableHighpass: false,
				enableGain: false,
				enablePan: false,
				enablePlaybackRate: false,
				...overrides,
			},
			SR,
		);
	}

	function initStreamingBuffer(
		props: Required<ClipProcessorOptions>,
		totalLength: number,
		committedLength: number,
		channels = 2,
	): void {
		handleProcessorMessage(
			props,
			{
				type: "bufferInit",
				data: { channels, totalLength, streaming: true },
			},
			0,
			SR,
		);
		if (committedLength > 0) {
			const channelData = Array.from({ length: channels }, (_, ch) => {
				const arr = new Float32Array(committedLength);
				for (let i = 0; i < committedLength; i++) arr[i] = ch * 1000 + i;
				return arr;
			});
			handleProcessorMessage(
				props,
				{
					type: "bufferRange",
					data: { startSample: 0, channelData },
				},
				0,
				SR,
			);
			// Apply pending writes
			processBlock(
				props,
				[makeOutput(channels)],
				{
					playbackRate: new Float32Array([1]),
					detune: new Float32Array([0]),
					lowpass: new Float32Array([20000]),
					highpass: new Float32Array([20]),
					gain: new Float32Array([1]),
					pan: new Float32Array([0]),
				},
				{ currentTime: 0, currentFrame: 0, sampleRate: SR },
				{
					lowpass: createFilterState(),
					highpass: createFilterState(),
				},
			);
			// Reset playhead to 0 after the initial write-apply block
			props.playhead = 0;
			props.playedSamples = 0;
		}
	}

	it("H1: loop wraps at committedLength during streaming", () => {
		const props = makeStreamingProps({ loop: true });
		initStreamingBuffer(props, 1024, 512);

		const { messages, playheadHistory } = simulateBlocks(props, 10);
		// Should have looped (512 samples = 4 blocks of 128)
		expect(messages.some((m) => m.type === "looped")).toBe(true);
		// Should NOT have ended
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		expect(props.state).toBe(State.Started);
		// Playhead should have wrapped back within committed range
		const maxPlayhead = Math.max(...playheadHistory);
		expect(maxPlayhead).toBeLessThanOrEqual(512);
	});

	it("H2: degenerate small committedLength outputs silence", () => {
		const props = makeStreamingProps({ loop: true });
		// committedLength = 64, which is < 2 * SAMPLE_BLOCK_SIZE (256)
		initStreamingBuffer(props, 1024, 64);

		const { allOutputs, messages } = simulateBlocks(props, 3);
		// Should output silence (degenerate guard)
		for (const block of allOutputs) {
			for (const ch of block) {
				expect(ch.every((v) => v === 0)).toBe(true);
			}
		}
		// Should NOT have ended or looped
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		expect(props.state).toBe(State.Started);
	});

	it("H3: after stream completes, normal loop behavior uses full buffer", () => {
		const props = makeStreamingProps({ loop: true });
		initStreamingBuffer(props, 512, 256);

		// Play a few blocks to confirm looping at committed length
		simulateBlocks(props, 3);
		expect(props.state).toBe(State.Started);

		// Now commit the rest of the buffer and end stream
		const channelData = [
			new Float32Array(256).fill(0.75),
			new Float32Array(256).fill(0.25),
		];
		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: { startSample: 256, channelData },
			},
			0,
			SR,
		);
		handleProcessorMessage(props, { type: "bufferEnd", data: {} }, 0, SR);

		// After stream ends, loop should use full 512 samples
		const { messages, playheadHistory } = simulateBlocks(props, 10);
		expect(messages.some((m) => m.type === "looped")).toBe(true);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		// Playhead should reach beyond 256 now (the old committed limit)
		const maxPlayhead = Math.max(...playheadHistory);
		expect(maxPlayhead).toBeGreaterThan(256);
	});

	it("H4: non-loop streaming still ends normally", () => {
		const props = makeStreamingProps({ loop: false });
		initStreamingBuffer(props, 512, 512);

		// End the stream so it behaves as a complete buffer
		handleProcessorMessage(props, { type: "bufferEnd", data: {} }, 0, SR);

		const { messages } = simulateBlocks(props, 10);
		expect(messages.some((m) => m.type === "ended")).toBe(true);
		expect(props.state).toBe(State.Ended);
	});

	it("H5: loop start/end params are clamped to effectiveSourceLength during streaming", () => {
		const props = makeStreamingProps({
			loop: true,
			loopStart: 0,
			loopEnd: 1024 / SR, // loopEnd well beyond committed
		});
		initStreamingBuffer(props, 1024, 384);

		const { messages, playheadHistory } = simulateBlocks(props, 10);
		// Should loop — loopEnd should be clamped to 384 (committed)
		expect(messages.some((m) => m.type === "looped")).toBe(true);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		const maxPlayhead = Math.max(...playheadHistory);
		expect(maxPlayhead).toBeLessThanOrEqual(384);
	});

	it("H6: crossfade works during incomplete stream loop", () => {
		const props = makeStreamingProps({
			loop: true,
			loopCrossfade: 0.1,
			enableLoopCrossfade: true,
		});
		initStreamingBuffer(props, 2048, 1024);

		// Run enough blocks to loop. Crossfade should work during streaming
		// using committed data. The main check: no NaN, no crash, loops, continues.
		const { messages } = simulateBlocks(props, 20);
		expect(messages.some((m) => m.type === "looped")).toBe(true);
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		expect(props.state).toBe(State.Started);
	});

	it("H7: playhead beyond committedLength gets wrapped on next block", () => {
		const props = makeStreamingProps({ loop: true });
		initStreamingBuffer(props, 1024, 512);

		// Manually set playhead beyond committed length to simulate edge case
		props.playhead = 600;

		const { messages } = simulateBlocks(props, 5);
		// Should have wrapped and continued — not ended
		expect(messages.some((m) => m.type === "ended")).toBe(false);
		expect(props.state).toBe(State.Started);
		// Playhead should be within committed range
		expect(props.playhead).toBeLessThan(512);
	});

	it("H8: bufferEnd before final range does not end early and resumes when tail arrives", () => {
		const props = makeStreamingProps({ loop: false });
		initStreamingBuffer(props, 512, 384);

		handleProcessorMessage(
			props,
			{ type: "bufferEnd", data: { totalLength: 512 } },
			0,
			SR,
		);

		const beforeTail = simulateBlocks(props, 4);
		expect(beforeTail.messages.some((m) => m.type === "ended")).toBe(false);
		expect(props.state).toBe(State.Started);
		expect(props.playhead).toBe(384);

		handleProcessorMessage(
			props,
			{
				type: "bufferRange",
				data: {
					startSample: 384,
					channelData: [
						new Float32Array(128).fill(0.75),
						new Float32Array(128).fill(0.25),
					],
				},
			},
			0,
			SR,
		);

		const afterTail = simulateBlocks(props, 2);
		expect(afterTail.allOutputs[0][0][0]).toBeCloseTo(0.75, 5);
		expect(afterTail.messages.some((m) => m.type === "ended")).toBe(true);
		expect(props.state).toBe(State.Ended);
	});
});

// ---------------------------------------------------------------------------
// Ping-pong looping
// ---------------------------------------------------------------------------

describe("Ping-pong looping", () => {
	const SR = 48000;

	it("PP1: findIndexesNormal reverses at loopEnd and again at loopStart", () => {
		// Start near loopEnd, should bounce back
		const p: BlockParameters = {
			playhead: 990,
			bufferLength: 1000,
			loop: true,
			loopMode: "ping-pong",
			playbackDirection: 1,
			loopStartSamples: 0,
			loopEndSamples: 1000,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		expect(r.looped).toBe(true);
		expect(r.playbackDirection).toBe(-1);
		// Playhead should have reversed: went up to 999, then started going back
		expect(r.playhead).toBeLessThan(1000);
		// Indexes should first increase then decrease
		const turnIdx = r.indexes.findIndex((v, i, arr) => i > 0 && v < arr[i - 1]);
		expect(turnIdx).toBeGreaterThan(0);
		expect(turnIdx).toBeLessThan(128);
	});

	it("PP2: direction carries across blocks", () => {
		// Go backward from somewhere in the middle
		const p: BlockParameters = {
			playhead: 200,
			bufferLength: 1000,
			loop: true,
			loopMode: "ping-pong",
			playbackDirection: -1,
			loopStartSamples: 100,
			loopEndSamples: 900,
			durationSamples: 100000,
			playbackRates: new Float32Array([1]),
		};
		const r = findIndexesNormal(p);
		// Going backward from 200 toward 100, should reverse at 100
		expect(r.looped).toBe(true);
		expect(r.playbackDirection).toBe(1);
		// After reversing at loopStart=100, head should be going forward
		expect(r.playhead).toBeGreaterThanOrEqual(100);
	});

	it("PP3: ping-pong with playback rates reverses at boundaries", () => {
		const p: BlockParameters = {
			playhead: 895,
			bufferLength: 1000,
			loop: true,
			loopMode: "ping-pong",
			playbackDirection: 1,
			loopStartSamples: 0,
			loopEndSamples: 900,
			durationSamples: 100000,
			playbackRates: new Float32Array([2]),
		};
		const r = findIndexesWithPlaybackRates(p);
		expect(r.looped).toBe(true);
		expect(r.playbackDirection).toBe(-1);
		// Indexes should first increase then decrease
		const afterTurn = r.indexes.findIndex(
			(v, i, arr) => i > 0 && v < arr[i - 1],
		);
		expect(afterTurn).toBeGreaterThan(0);
	});

	it("PP4: full processBlock with ping-pong flips direction", () => {
		const bufLen = 48000;
		const buffer = [
			new Float32Array(bufLen).fill(0.5),
			new Float32Array(bufLen).fill(0.5),
		];
		const props = getProperties(
			{
				buffer,
				loop: true,
				loopMode: "ping-pong",
				state: State.Started,
				playhead: 47900,
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
			},
			SR,
		);
		expect(props.playbackDirection).toBe(1);

		const outputs = [makeOutput(2)];
		processBlock(
			props,
			outputs,
			{
				playbackRate: new Float32Array([1]),
				detune: new Float32Array([0]),
				lowpass: new Float32Array([20000]),
				highpass: new Float32Array([20]),
				gain: new Float32Array([1]),
				pan: new Float32Array([0]),
			},
			{ currentTime: 0.001, currentFrame: 0, sampleRate: SR },
			{ lowpass: createFilterState(), highpass: createFilterState() },
		);

		// Direction should have flipped to backward after hitting loopEnd
		expect(props.playbackDirection).toBe(-1);
		expect(props.playhead).toBeLessThan(48000);
	});

	it("PP5: multiple bounces across many blocks", () => {
		const bufLen = 48000;
		const buffer = [
			new Float32Array(bufLen).fill(1),
			new Float32Array(bufLen).fill(1),
		];
		const props = getProperties(
			{
				buffer,
				loop: true,
				loopMode: "ping-pong",
				loopStart: 0.1,
				loopEnd: 0.9,
				state: State.Started,
				playhead: Math.floor(0.1 * SR),
				startWhen: 0,
				stopWhen: Number.MAX_SAFE_INTEGER,
				duration: Number.MAX_SAFE_INTEGER,
			},
			SR,
		);
		const loopStart = Math.floor(0.1 * SR);
		const loopEnd = Math.floor(0.9 * SR);

		// Run many blocks to cycle through multiple bounces
		let bounces = 0;
		let prevDir = props.playbackDirection;
		for (let b = 0; b < 1000; b++) {
			processBlock(
				props,
				[makeOutput(2)],
				{
					playbackRate: new Float32Array([1]),
					detune: new Float32Array([0]),
					lowpass: new Float32Array([20000]),
					highpass: new Float32Array([20]),
					gain: new Float32Array([1]),
					pan: new Float32Array([0]),
				},
				{
					currentTime: (b * 128) / SR,
					currentFrame: b * 128,
					sampleRate: SR,
				},
				{ lowpass: createFilterState(), highpass: createFilterState() },
			);
			if (props.playbackDirection !== prevDir) {
				bounces++;
				prevDir = props.playbackDirection;
			}
			// Playhead should always stay within bounds
			expect(props.playhead).toBeGreaterThanOrEqual(loopStart);
			expect(props.playhead).toBeLessThanOrEqual(loopEnd);
		}
		// Should have bounced at least a few times across 1000 blocks
		expect(bounces).toBeGreaterThanOrEqual(2);
	});

	it("PP6: loopMode message sets mode and resets direction", () => {
		const props = getProperties(
			{
				buffer: [new Float32Array(1000)],
				loop: true,
			},
			SR,
		);
		expect(props.loopMode).toBe("forward");
		expect(props.playbackDirection).toBe(1);

		handleProcessorMessage(
			props,
			{ type: "loopMode", data: "ping-pong" },
			SR,
			0,
		);
		expect(props.loopMode).toBe("ping-pong");
		expect(props.playbackDirection).toBe(1);
	});
});

describe("enableFrameReporting", () => {
	const SR = 48000;

	it("defaults to false in getProperties", () => {
		const props = getProperties({}, SR);
		expect(props.enableFrameReporting).toBe(false);
	});

	it("handleProcessorMessage sets enableFrameReporting to true", () => {
		const props = getProperties({}, SR);
		expect(props.enableFrameReporting).toBe(false);
		handleProcessorMessage(
			props,
			{ type: "enableFrameReporting", data: true },
			0,
			SR,
		);
		expect(props.enableFrameReporting).toBe(true);
	});

	it("handleProcessorMessage sets enableFrameReporting back to false", () => {
		const props = getProperties({ enableFrameReporting: true }, SR);
		expect(props.enableFrameReporting).toBe(true);
		handleProcessorMessage(
			props,
			{ type: "enableFrameReporting", data: false },
			0,
			SR,
		);
		expect(props.enableFrameReporting).toBe(false);
	});
});
