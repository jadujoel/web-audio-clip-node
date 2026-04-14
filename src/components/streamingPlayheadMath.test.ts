import { describe, expect, test } from "bun:test";
import { SAMPLE_RATE } from "../controls/controlDefs";
import { buildStreamingPlayheadModel } from "./streamingPlayheadMath";

describe("buildStreamingPlayheadModel", () => {
	test("uses seekable ratio when duration is known", () => {
		const model = buildStreamingPlayheadModel({
			value: 0,
			audioDuration: 10,
			seekableSamples: 2 * SAMPLE_RATE,
			streamProgress: 0.9,
		});

		expect(model.maxSamples).toBe(10 * SAMPLE_RATE);
		expect(model.decodedRatio).toBe(0.2);
		expect(model.decodedPercent).toBe(20);
	});

	test("falls back to stream progress when duration is unknown", () => {
		const model = buildStreamingPlayheadModel({
			value: 12_000,
			audioDuration: null,
			seekableSamples: 48_000,
			streamProgress: 0.4,
		});

		expect(model.maxSamples).toBe(48_000);
		expect(model.decodedRatio).toBe(0.4);
		expect(model.decodedPercent).toBe(40);
	});

	test("clamps negative and NaN progress to zero", () => {
		const negative = buildStreamingPlayheadModel({
			value: 0,
			audioDuration: null,
			seekableSamples: null,
			streamProgress: -2,
		});
		const nanProgress = buildStreamingPlayheadModel({
			value: 0,
			audioDuration: null,
			seekableSamples: null,
			streamProgress: Number.NaN,
		});

		expect(negative.decodedRatio).toBe(0);
		expect(nanProgress.decodedRatio).toBe(0);
	});

	test("clamps overshoot ratio to one", () => {
		const model = buildStreamingPlayheadModel({
			value: 0,
			audioDuration: 3,
			seekableSamples: 999_999,
			streamProgress: 0,
		});

		expect(model.decodedRatio).toBe(1);
		expect(model.decodedPercent).toBe(100);
	});

	test("uses current value as max fallback when duration and seekable are unknown", () => {
		const model = buildStreamingPlayheadModel({
			value: 11_111,
			audioDuration: null,
			seekableSamples: null,
			streamProgress: 0.25,
		});

		expect(model.maxSamples).toBe(11_111);
		expect(model.decodedRatio).toBe(0.25);
	});
});
