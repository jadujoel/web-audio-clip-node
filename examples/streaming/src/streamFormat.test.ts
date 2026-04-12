import { describe, expect, it } from "bun:test";
import {
	detectStreamFormat,
	getDefaultUrlForFormat,
} from "./streamFormat";

describe("streamFormat", () => {
	it("detects opus and ogg URLs as opus format", () => {
		expect(detectStreamFormat("https://example.com/audio.opus")).toBe("opus");
		expect(detectStreamFormat("https://example.com/audio.ogg?x=1")).toBe("opus");
		expect(detectStreamFormat("https://example.com/AUDIO.OGG")).toBe("opus");
	});

	it("detects mp3 URLs as mp3 format", () => {
		expect(detectStreamFormat("https://example.com/audio.mp3")).toBe("mp3");
	});

	it("falls back to mp3 for unknown extensions", () => {
		expect(detectStreamFormat("https://example.com/stream")).toBe("mp3");
	});

	it("returns format defaults", () => {
		expect(getDefaultUrlForFormat("opus")).toBe("example.opus");
		expect(getDefaultUrlForFormat("mp3")).toBe(
			"https://jadujoel.github.io/web-audio-clip-node/example.mp3",
		);
	});
});
