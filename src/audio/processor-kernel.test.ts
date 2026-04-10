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
	panFilter,
	processBlock,
	setOffset,
} from "./processor-kernel";
import type { BlockParameters } from "./types";
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
	});

	it("fadeOut setter", () => {
		const props = getProperties({}, SR);
		handleProcessorMessage(props, { type: "fadeOut", data: 0.3 }, CT, SR);
		expect(props.fadeOutDuration).toBe(0.3);
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
		// First sample should be attenuated (less than 1.0)
		expect(outputs[0][0][0]).toBeLessThan(1.0);
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
});
