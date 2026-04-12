import { describe, expect, it } from "bun:test";
import {
	detectStreamFormat,
	getDefaultUrlForFormat,
	usesBufferedContainerDecode,
} from "./streamFormat";

describe("streamFormat", () => {
	it("detects opus and ogg URLs as ogg opus format", () => {
		expect(detectStreamFormat("https://example.com/audio.opus")).toBe("ogg-opus");
		expect(detectStreamFormat("https://example.com/audio.ogg?x=1")).toBe("ogg-opus");
		expect(detectStreamFormat("https://example.com/AUDIO.OGG")).toBe("ogg-opus");
	});

	it("detects framed raw opus URLs", () => {
		expect(detectStreamFormat("https://example.com/audio.fopus")).toBe("raw-opus-framed");
		expect(detectStreamFormat("https://example.com/audio.opuspkt")).toBe("raw-opus-framed");
	});

	it("detects webm opus URLs", () => {
		expect(detectStreamFormat("https://example.com/audio.webm")).toBe("webm-opus");
	});

	it("detects mp3 URLs as mp3 format", () => {
		expect(detectStreamFormat("https://example.com/audio.mp3")).toBe("mp3");
	});

	it("falls back to mp3 for unknown extensions", () => {
		expect(detectStreamFormat("https://example.com/stream")).toBe("mp3");
	});

	it("returns format defaults", () => {
		expect(getDefaultUrlForFormat("ogg-opus")).toBe("../sounds/example.opus");
		expect(getDefaultUrlForFormat("raw-opus-framed")).toBe("");
		expect(getDefaultUrlForFormat("webm-opus")).toBe("../sounds/example.webm");
		expect(getDefaultUrlForFormat("mp3")).toBe(
			"../sounds/example.mp3",
		);
	});

	it("marks container formats for buffered decode fallback", () => {
		expect(usesBufferedContainerDecode("ogg-opus")).toBe(true);
		expect(usesBufferedContainerDecode("webm-opus")).toBe(true);
		expect(usesBufferedContainerDecode("mp3")).toBe(false);
		expect(usesBufferedContainerDecode("raw-opus-framed")).toBe(false);
	});
});
