import { describe, expect, it } from "bun:test";
import { formatValueText } from "./formatValueText";

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

	it("default → toPrecision(4)", () => {
		expect(formatValueText(Math.PI, "duration", "none", 120)).toBe("3.142");
	});
});
