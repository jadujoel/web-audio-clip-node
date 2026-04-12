import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectStreamFormat, usesBufferedContainerDecode } from "./streaming";

describe("streaming build output", () => {
	const workerFiles = [
		"aac-adts-decode-worker.min.js",
		"flac-decode-worker.min.js",
		"mp3-decode-worker.min.js",
		"mp4-aac-decode-worker.min.js",
		"ogg-flac-decode-worker.min.js",
		"ogg-opus-decode-worker.min.js",
		"ogg-vorbis-decode-worker.min.js",
		"raw-opus-framed-decode-worker.min.js",
		"webm-opus-decode-worker.min.js",
		"webm-vorbis-decode-worker.min.js",
	];

	for (const file of workerFiles) {
		test(`dist/workers/${file} exists after build`, () => {
			expect(existsSync(join("dist", "workers", file))).toBe(true);
		});
	}

	for (const file of workerFiles) {
		test(`dist/workers/${file} is IIFE format (no export/import statements)`, () => {
			const filePath = join("dist", "workers", file);
			if (!existsSync(filePath)) return; // skip if not built yet
			const code = readFileSync(filePath, "utf8");
			expect(code).not.toMatch(/\bexport\s/);
			expect(code).not.toMatch(/\bimport\s/);
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
	test("detects opus URLs as OggOpus format", () => {
		expect(detectStreamFormat("https://example.com/audio.opus")).toBe(
			"OggOpus",
		);
	});

	test("detects ogg and oga URLs as OggVorbis format", () => {
		expect(detectStreamFormat("https://example.com/audio.ogg?x=1")).toBe(
			"OggVorbis",
		);
		expect(detectStreamFormat("https://example.com/AUDIO.OGG")).toBe(
			"OggVorbis",
		);
		expect(detectStreamFormat("https://example.com/audio.oga")).toBe(
			"OggVorbis",
		);
	});

	test("detects OGG FLAC URLs as OggFlac format", () => {
		expect(detectStreamFormat("https://example.com/audio-flac.oga")).toBe(
			"OggFlac",
		);
		expect(detectStreamFormat("https://example.com/audio.flac.ogg")).toBe(
			"OggFlac",
		);
	});

	test("detects vorbis webm URLs as WebmVorbis format", () => {
		expect(detectStreamFormat("https://example.com/audio-vorbis.webm")).toBe(
			"WebmVorbis",
		);
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

	test("detects aac URLs as Aac format", () => {
		expect(detectStreamFormat("https://example.com/audio.aac")).toBe("Aac");
		expect(detectStreamFormat("https://example.com/AUDIO.AAC")).toBe("Aac");
	});

	test("detects flac URLs as Flac format", () => {
		expect(detectStreamFormat("https://example.com/audio.flac")).toBe("Flac");
		expect(detectStreamFormat("https://example.com/AUDIO.FLAC")).toBe("Flac");
	});

	test("detects m4a and mp4 URLs as Mp4Aac format", () => {
		expect(detectStreamFormat("https://example.com/audio.m4a")).toBe("Mp4Aac");
		expect(detectStreamFormat("https://example.com/audio.mp4")).toBe("Mp4Aac");
		expect(detectStreamFormat("https://example.com/AUDIO.M4A")).toBe("Mp4Aac");
	});

	test("falls back to Mp3 for unknown extensions", () => {
		expect(detectStreamFormat("https://example.com/stream")).toBe("Mp3");
	});
});

describe("usesBufferedContainerDecode", () => {
	test("marks container formats for buffered decode fallback", () => {
		expect(usesBufferedContainerDecode("OggOpus")).toBe(true);
		expect(usesBufferedContainerDecode("OggVorbis")).toBe(true);
		expect(usesBufferedContainerDecode("OggFlac")).toBe(true);
		expect(usesBufferedContainerDecode("Flac")).toBe(true);
		expect(usesBufferedContainerDecode("WebmOpus")).toBe(true);
		expect(usesBufferedContainerDecode("WebmVorbis")).toBe(true);
		expect(usesBufferedContainerDecode("Mp3")).toBe(false);
		expect(usesBufferedContainerDecode("RawOpusFramed")).toBe(false);
		expect(usesBufferedContainerDecode("Aac")).toBe(false);
		expect(usesBufferedContainerDecode("Mp4Aac")).toBe(true);
	});
});
