import { describe, expect, it } from "bun:test";
import {
	clampSeekTargetSamples,
	clampSeekTargetSeconds,
	estimateTotalSamplesFromContentLength,
	secondsFromSamples,
} from "./streamTimeline";

describe("streamTimeline", () => {
	it("estimates total samples from content length with fallback bitrate", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 128_000,
			bitrate: null,
			sourceSampleRate: 44_100,
			targetSampleRate: 48_000,
		});
		expect(estimated).toBe(384_000);
	});

	it("prefers frame bitrate when provided", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 48_000,
			bitrate: 192_000,
			sourceSampleRate: 48_000,
			targetSampleRate: 48_000,
		});
		expect(estimated).toBe(96_000);
	});

	it("returns null for invalid inputs", () => {
		expect(
			estimateTotalSamplesFromContentLength({
				totalBytes: null,
				bitrate: null,
				sourceSampleRate: 48_000,
				targetSampleRate: 48_000,
			}),
		).toBeNull();
	});

	it("converts decoded samples to seconds", () => {
		expect(secondsFromSamples(24_000, 48_000)).toBe(0.5);
		expect(secondsFromSamples(0, 48_000)).toBeNull();
	});

	it("clamps seek target to decoded region", () => {
		expect(clampSeekTargetSeconds(4, 2)).toEqual({ value: 2, clamped: true });
		expect(clampSeekTargetSeconds(1.5, 2)).toEqual({
			value: 1.5,
			clamped: false,
		});
		expect(clampSeekTargetSeconds(1.5, null)).toEqual({
			value: 1.5,
			clamped: false,
		});
	});

	it("clamps sample-based seek target to decoded samples", () => {
		expect(clampSeekTargetSamples(96_000, 48_000)).toEqual({
			value: 48_000,
			clamped: true,
		});
		expect(clampSeekTargetSamples(47_999.9, 48_000)).toEqual({
			value: 47_999,
			clamped: false,
		});
		expect(clampSeekTargetSamples(-100, 48_000)).toEqual({
			value: 0,
			clamped: false,
		});
	});
});
