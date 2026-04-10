import { describe, expect, it } from "bun:test";
import { dbFromLin, getSnappedValue, getUnitValue, linFromDb } from "./utils";

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
		// 1 8th = 60/120/8 = 0.0625s
		const sp8 = 60 / tempo / 8;
		expect(getSnappedValue(0.07, "8th", tempo)).toBeCloseTo(sp8);
	});

	it("16th snap", () => {
		const sp16 = 60 / tempo / 16;
		expect(getSnappedValue(0.02, "16th", tempo)).toBeCloseTo(sp16);
	});

	it("int snap: rounds to nearest integer", () => {
		expect(getSnappedValue(2.3, "int", tempo)).toBe(2);
		expect(getSnappedValue(2.7, "int", tempo)).toBe(3);
	});

	it("no snap: returns value unchanged", () => {
		expect(getSnappedValue(1.234, "none", tempo)).toBe(1.234);
	});
});

describe("getUnitValue", () => {
	it("dB unit: converts via dbFromLin", () => {
		expect(getUnitValue(1, "dB")).toBeCloseTo(0);
	});

	it("log10 unit", () => {
		expect(getUnitValue(100, "log10")).toBeCloseTo(2);
	});

	it("log2 unit", () => {
		expect(getUnitValue(8, "log2")).toBeCloseTo(3);
	});

	it("default (lin): returns value unchanged", () => {
		expect(getUnitValue(42, "lin")).toBe(42);
	});
});
