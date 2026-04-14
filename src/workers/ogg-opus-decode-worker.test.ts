import { describe, expect, test } from "bun:test";
import {
	getOpusPacketDurationSamples,
	getOpusSamplesPerFrame,
} from "./ogg-opus-decode-worker";

describe("ogg-opus packet duration helpers", () => {
	test("maps SILK, hybrid, and CELT configs to samples-per-frame", () => {
		expect(getOpusSamplesPerFrame(0)).toBe(480);
		expect(getOpusSamplesPerFrame(3)).toBe(2880);
		expect(getOpusSamplesPerFrame(12)).toBe(480);
		expect(getOpusSamplesPerFrame(13)).toBe(960);
		expect(getOpusSamplesPerFrame(16)).toBe(120);
		expect(getOpusSamplesPerFrame(19)).toBe(960);
	});

	test("derives packet duration for single-frame, two-frame, and VBR-count packets", () => {
		// CELT config 19 => 20ms/frame => 960 samples
		expect(getOpusPacketDurationSamples(new Uint8Array([(19 << 3) | 0]))).toBe(
			960,
		);
		// Same frame size, two CBR frames
		expect(getOpusPacketDurationSamples(new Uint8Array([(19 << 3) | 1]))).toBe(
			1920,
		);
		// VBR count in second byte: 3 frames
		expect(
			getOpusPacketDurationSamples(new Uint8Array([(19 << 3) | 3, 0b00000011])),
		).toBe(2880);
	});
});
