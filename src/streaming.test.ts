import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectStreamFormat, usesBufferedContainerDecode } from "./streaming";

describe("streaming build output", () => {
	const workerFiles = [
		"mp3-decode-worker.min.js",
		"ogg-opus-decode-worker.min.js",
		"raw-opus-framed-decode-worker.min.js",
		"webm-opus-decode-worker.min.js",
	];

	for (const file of workerFiles) {
		test(`dist/workers/${file} exists after build`, () => {
			expect(existsSync(join("dist", "workers", file))).toBe(true);
		});
	}

	test("dist/streaming.js exists after build", () => {
		expect(existsSync("dist/streaming.js")).toBe(true);
	});

	test("dist/streaming.d.ts exists after build", () => {
		expect(existsSync("dist/streaming.d.ts")).toBe(true);
	});
});

describe("detectStreamFormat", () => {
	test("detects opus and ogg URLs as OggOpus format", () => {
		expect(detectStreamFormat("https://example.com/audio.opus")).toBe(
			"OggOpus",
		);
		expect(detectStreamFormat("https://example.com/audio.ogg?x=1")).toBe(
			"OggOpus",
		);
		expect(detectStreamFormat("https://example.com/AUDIO.OGG")).toBe("OggOpus");
	});

	test("detects framed raw opus URLs", () => {
		expect(detectStreamFormat("https://example.com/audio.fopus")).toBe(
			"RawOpusFramed",
		);
		expect(detectStreamFormat("https://example.com/audio.opuspkt")).toBe(
			"RawOpusFramed",
		);
	});

	test("detects webm opus URLs", () => {
		expect(detectStreamFormat("https://example.com/audio.webm")).toBe(
			"WebmOpus",
		);
	});

	test("detects mp3 URLs as Mp3 format", () => {
		expect(detectStreamFormat("https://example.com/audio.mp3")).toBe("Mp3");
	});

	test("falls back to Mp3 for unknown extensions", () => {
		expect(detectStreamFormat("https://example.com/stream")).toBe("Mp3");
	});
});

describe("usesBufferedContainerDecode", () => {
	test("marks container formats for buffered decode fallback", () => {
		expect(usesBufferedContainerDecode("OggOpus")).toBe(true);
		expect(usesBufferedContainerDecode("WebmOpus")).toBe(true);
		expect(usesBufferedContainerDecode("Mp3")).toBe(false);
		expect(usesBufferedContainerDecode("RawOpusFramed")).toBe(false);
	});
});
