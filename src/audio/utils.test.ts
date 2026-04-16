import { describe, expect, it } from "vitest";
import { createContext } from "../../TestPreload";
import {
	audioBufferFromFloat32Array,
	dbFromLin,
	float32ArrayFromAudioBuffer,
	generateSnapPoints,
	getSnappedValue,
	getTempoSnapInterval,
	isTempoRelativeSnap,
	linFromDb,
	remapTempoRelativeValue,
} from "./utils";

describe("dbFromLin / linFromDb", () => {
	it("round-trip: linFromDb(dbFromLin(x)) ≈ x", () => {
		for (const x of [0.001, 0.01, 0.1, 0.5, 1.0, 2.0]) {
			expect(linFromDb(dbFromLin(x))).toBeCloseTo(x, 5);
		}
	});

	it("dbFromLin(1) = 0 dB", () => {
		expect(dbFromLin(1)).toBeCloseTo(0);
	});

	it("dbFromLin(0) returns -1000 (clamped)", () => {
		expect(dbFromLin(0)).toBe(-1000);
	});

	it("linFromDb(0) = 1", () => {
		expect(linFromDb(0)).toBeCloseTo(1);
	});

	it("linFromDb(-6) ≈ 0.5", () => {
		expect(linFromDb(-6)).toBeCloseTo(0.5012, 3);
	});
});

describe("getSnappedValue", () => {
	const tempo = 120; // 2 beats per second

	it("beat snap: rounds to nearest beat", () => {
		// At 120 BPM, 1 beat = 0.5s
		expect(getSnappedValue(0.3, "beat", tempo)).toBeCloseTo(0.5);
		expect(getSnappedValue(0.1, "beat", tempo)).toBeCloseTo(0);
		expect(getSnappedValue(0.74, "beat", tempo)).toBeCloseTo(0.5);
		expect(getSnappedValue(0.76, "beat", tempo)).toBeCloseTo(1.0);
	});

	it("bar snap: rounds to nearest bar (4 beats)", () => {
		// 1 bar = 2.0s at 120 BPM
		expect(getSnappedValue(1.5, "bar", tempo)).toBeCloseTo(2.0);
		expect(getSnappedValue(0.5, "bar", tempo)).toBeCloseTo(0);
	});

	it("8th snap", () => {
		const sp8 = 60 / tempo / 2;
		expect(getSnappedValue(0.14, "8th", tempo)).toBeCloseTo(sp8);
	});

	it("16th snap", () => {
		const sp16 = 60 / tempo / 4;
		expect(getSnappedValue(0.08, "16th", tempo)).toBeCloseTo(sp16);
	});

	it("int snap: rounds to nearest integer", () => {
		expect(getSnappedValue(2.3, "int", tempo)).toBe(2);
		expect(getSnappedValue(2.7, "int", tempo)).toBe(3);
	});

	it("no snap: returns value unchanged", () => {
		expect(getSnappedValue(1.234, "none", tempo)).toBe(1.234);
	});
});

describe("tempo-relative helpers", () => {
	it("detects tempo-relative snap modes", () => {
		expect(isTempoRelativeSnap("beat")).toBe(true);
		expect(isTempoRelativeSnap("bar")).toBe(true);
		expect(isTempoRelativeSnap("8th")).toBe(true);
		expect(isTempoRelativeSnap("16th")).toBe(true);
		expect(isTempoRelativeSnap("none")).toBe(false);
	});

	it("returns the correct interval for each tempo-relative snap", () => {
		expect(getTempoSnapInterval("beat", 120)).toBeCloseTo(0.5);
		expect(getTempoSnapInterval("bar", 120)).toBeCloseTo(2);
		expect(getTempoSnapInterval("8th", 120)).toBeCloseTo(0.25);
		expect(getTempoSnapInterval("16th", 120)).toBeCloseTo(0.125);
	});

	it("remaps a beat-snapped value to preserve beat count", () => {
		expect(remapTempoRelativeValue(1, "beat", 120, 60, 0, 10)).toBeCloseTo(2);
	});

	it("remaps a bar-snapped value to preserve bar count", () => {
		expect(remapTempoRelativeValue(2, "bar", 120, 60, 0, 10)).toBeCloseTo(4);
	});

	it("clamps remapped values to the effective range", () => {
		expect(remapTempoRelativeValue(2, "beat", 120, 30, 0, 3)).toBe(3);
	});

	it("keeps sentinel negative values unchanged", () => {
		expect(remapTempoRelativeValue(-1, "beat", 120, 60, -1, 10)).toBe(-1);
	});
});

describe("float32ArrayFromAudioBuffer", () => {
	it("returns single channel array for mono buffer", () => {
		const ctx = createContext();
		const ab = ctx.createBuffer(1, 128, ctx.sampleRate);
		const data = ab.getChannelData(0);
		data[0] = 0.5;
		const result = float32ArrayFromAudioBuffer(ab);
		expect(result.length).toBe(1);
		expect(result[0][0]).toBeCloseTo(0.5);
	});

	it("returns two channel arrays for stereo buffer", () => {
		const ctx = createContext();
		const ab = ctx.createBuffer(2, 128, ctx.sampleRate);
		ab.getChannelData(0)[0] = 0.25;
		ab.getChannelData(1)[0] = 0.75;
		const result = float32ArrayFromAudioBuffer(ab);
		expect(result.length).toBe(2);
		expect(result[0][0]).toBeCloseTo(0.25);
		expect(result[1][0]).toBeCloseTo(0.75);
	});
});

describe("audioBufferFromFloat32Array", () => {
	it("returns undefined for undefined data", () => {
		const ctx = createContext();
		expect(audioBufferFromFloat32Array(ctx, undefined)).toBeUndefined();
	});

	it("returns undefined for empty array", () => {
		const ctx = createContext();
		expect(audioBufferFromFloat32Array(ctx, [])).toBeUndefined();
	});

	it("creates AudioBuffer from mono Float32Array data", () => {
		const ctx = createContext();
		const data = [new Float32Array([0.1, 0.2, 0.3])];
		const result = audioBufferFromFloat32Array(ctx, data);
		expect(result).toBeDefined();
		expect(result?.numberOfChannels).toBe(1);
		expect(result?.length).toBe(3);
	});

	it("creates AudioBuffer from stereo Float32Array data", () => {
		const ctx = createContext();
		const data = [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])];
		const result = audioBufferFromFloat32Array(ctx, data);
		expect(result).toBeDefined();
		expect(result?.numberOfChannels).toBe(2);
		expect(result?.length).toBe(2);
	});
});

describe("generateSnapPoints", () => {
	const tempo = 120; // 1 beat = 0.5s

	it("beat: generates multiples of 0.5s", () => {
		const points = generateSnapPoints("beat", tempo, 0, 2);
		expect(points).toEqual([0, 0.5, 1, 1.5, 2]);
	});

	it("bar: generates multiples of 2s (4 beats)", () => {
		const points = generateSnapPoints("bar", tempo, 0, 4);
		expect(points).toEqual([0, 2, 4]);
	});

	it("8th: generates multiples of 0.25s", () => {
		const points = generateSnapPoints("8th", tempo, 0, 1);
		expect(points).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});

	it("16th: generates multiples of 0.125s", () => {
		const points = generateSnapPoints("16th", tempo, 0, 0.5);
		expect(points).toEqual([0, 0.125, 0.25, 0.375, 0.5]);
	});

	it("int: generates integer values", () => {
		const points = generateSnapPoints("int", tempo, 0, 4);
		expect(points).toEqual([0, 1, 2, 3, 4]);
	});

	it("none: returns empty array", () => {
		expect(generateSnapPoints("none", tempo, 0, 4)).toEqual([]);
	});

	it("respects min boundary", () => {
		const points = generateSnapPoints("beat", tempo, 0.6, 2);
		expect(points).toEqual([1, 1.5, 2]);
	});
});
