import { describe, expect, it } from "bun:test";
import {
	clampSeekTargetSamples,
	clampSeekTargetSeconds,
	estimateByteOffsetFromSample,
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

	it("uses format-specific default bitrate for FLAC (~800kbps)", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 100_000,
			bitrate: null,
			sourceSampleRate: 48_000,
			targetSampleRate: 48_000,
			format: "Flac",
		});
		// 100_000 * 8 / 800_000 = 1 second → 48_000 samples
		expect(estimated).toBe(48_000);
	});

	it("uses format-specific default bitrate for Mp3 (~192kbps)", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 24_000,
			bitrate: null,
			sourceSampleRate: 48_000,
			targetSampleRate: 48_000,
			format: "Mp3",
		});
		// 24_000 * 8 / 192_000 = 1 second → 48_000 samples
		expect(estimated).toBe(48_000);
	});

	it("explicit bitrate overrides format default", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 48_000,
			bitrate: 192_000,
			sourceSampleRate: 48_000,
			targetSampleRate: 48_000,
			format: "Flac",
		});
		// bitrate 192kbps takes precedence over Flac's 800kbps default
		expect(estimated).toBe(96_000);
	});

	it("unknown format falls back to generic 128kbps", () => {
		const estimated = estimateTotalSamplesFromContentLength({
			totalBytes: 128_000,
			bitrate: null,
			sourceSampleRate: 48_000,
			targetSampleRate: 48_000,
			format: "UnknownFormat",
		});
		// 128_000 * 8 / 128_000 = 8 seconds → 384_000 samples
		expect(estimated).toBe(384_000);
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

	it("estimates byte offset from sample offset", () => {
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: 24_000,
				totalSamples: 48_000,
				totalBytes: 100_000,
			}),
		).toBe(50_000);
	});

	it("returns 0 for zero or negative sampleOffset", () => {
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: 0,
				totalSamples: 48_000,
				totalBytes: 100_000,
			}),
		).toBe(0);
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: -1,
				totalSamples: 48_000,
				totalBytes: 100_000,
			}),
		).toBe(0);
	});

	it("returns 0 when totalSamples or totalBytes is 0", () => {
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: 24_000,
				totalSamples: 0,
				totalBytes: 100_000,
			}),
		).toBe(0);
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: 24_000,
				totalSamples: 48_000,
				totalBytes: 0,
			}),
		).toBe(0);
	});

	it("clamps byte offset to totalBytes when sampleOffset exceeds totalSamples", () => {
		expect(
			estimateByteOffsetFromSample({
				sampleOffset: 96_000,
				totalSamples: 48_000,
				totalBytes: 100_000,
			}),
		).toBe(100_000);
	});
});
