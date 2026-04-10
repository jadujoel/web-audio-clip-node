import { describe, expect, it } from "bun:test";
import { formatTickLabel, formatValueText } from "./formatValueText";

describe("formatValueText", () => {
	it("gain key → dB", () => {
		expect(formatValueText(-6, "gain", "none", 120)).toBe("-6.0 dB");
		expect(formatValueText(0, "gain", "none", 120)).toBe("0.0 dB");
	});

	it("lowpass key → Hz", () => {
		expect(formatValueText(1000, "lowpass", "none", 120)).toBe("1000 Hz");
	});

	it("highpass key → Hz", () => {
		expect(formatValueText(440, "highpass", "none", 120)).toBe("440 Hz");
	});

	it("detune key → cents", () => {
		expect(formatValueText(100, "detune", "none", 120)).toBe("100 cents");
		expect(formatValueText(-200, "detune", "none", 120)).toBe("-200 cents");
	});

	it("pan key → left/right/center", () => {
		expect(formatValueText(0, "pan", "none", 120)).toBe("center");
		expect(formatValueText(-0.5, "pan", "none", 120)).toBe("0.50 left");
		expect(formatValueText(0.75, "pan", "none", 120)).toBe("0.75 right");
	});

	it("playbackRate key → multiplier", () => {
		expect(formatValueText(1, "playbackRate", "none", 120)).toBe("1.00x");
		expect(formatValueText(2, "playbackRate", "none", 120)).toBe("2.00x");
	});

	it("playhead key → sample number", () => {
		expect(formatValueText(48000, "playhead", "none", 120)).toBe(
			"sample 48000",
		);
	});

	it("beat snap → shows beats (integer)", () => {
		// 120 BPM, 1 beat = 0.5s
		expect(formatValueText(0.5, "offset", "beat", 120)).toBe("1 beats");
		expect(formatValueText(1.0, "offset", "beat", 120)).toBe("2 beats");
	});

	it("bar snap → shows bars (integer)", () => {
		// 120 BPM, 1 bar = 2.0s
		expect(formatValueText(2.0, "offset", "bar", 120)).toBe("1 bars");
		expect(formatValueText(4.0, "offset", "bar", 120)).toBe("2 bars");
	});

	it("8th snap → shows 8ths (integer)", () => {
		// 120 BPM, 1 8th = 0.25s
		expect(formatValueText(0.25, "offset", "8th", 120)).toBe("1 8ths");
		expect(formatValueText(0.5, "offset", "8th", 120)).toBe("2 8ths");
	});

	it("16th snap → shows 16ths (integer)", () => {
		// 120 BPM, 1 16th = 0.125s
		expect(formatValueText(0.125, "offset", "16th", 120)).toBe("1 16ths");
		expect(formatValueText(0.25, "offset", "16th", 120)).toBe("2 16ths");
	});

	it("integer snap → rounded seconds", () => {
		expect(formatValueText(2.7, "offset", "integer", 120)).toBe("3 s");
		expect(formatValueText(0.4, "duration", "integer", 120)).toBe("0 s");
	});

	it("default (no snap) → seconds with precision", () => {
		expect(formatValueText(Math.PI, "duration", "none", 120)).toBe("3.142 s");
	});
});

describe("formatTickLabel", () => {
	it("gain → number only, no dB", () => {
		expect(formatTickLabel(-6, "gain", "none", 120)).toBe("-6.0");
	});

	it("lowpass → number only, no Hz", () => {
		expect(formatTickLabel(1000, "lowpass", "none", 120)).toBe("1000");
	});

	it("detune → number only, no cents", () => {
		expect(formatTickLabel(100, "detune", "none", 120)).toBe("100");
	});

	it("pan → compact L/R/C", () => {
		expect(formatTickLabel(0, "pan", "none", 120)).toBe("C");
		expect(formatTickLabel(-0.5, "pan", "none", 120)).toBe("0.50L");
		expect(formatTickLabel(0.75, "pan", "none", 120)).toBe("0.75R");
	});

	it("beat snap → number only, no 'beats'", () => {
		expect(formatTickLabel(0.5, "offset", "beat", 120)).toBe("1");
		expect(formatTickLabel(1.0, "offset", "beat", 120)).toBe("2");
	});

	it("bar snap → number only, no 'bars'", () => {
		expect(formatTickLabel(2.0, "offset", "bar", 120)).toBe("1");
	});

	it("8th snap → number only", () => {
		expect(formatTickLabel(0.25, "offset", "8th", 120)).toBe("1");
	});

	it("16th snap → number only", () => {
		expect(formatTickLabel(0.125, "offset", "16th", 120)).toBe("1");
	});

	it("integer snap → number only, no 's'", () => {
		expect(formatTickLabel(3, "offset", "integer", 120)).toBe("3");
	});

	it("default → number only, no 's'", () => {
		expect(formatTickLabel(Math.PI, "duration", "none", 120)).toBe("3.142");
	});
});
