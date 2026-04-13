import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StreamFormat } from "./streaming";
import {
	createCdnWorkerFactory,
	detectStreamFormat,
	detectStreamFormatFromResponse,
	formatFromContentType,
	usesBufferedContainerDecode,
	workerFileMap,
} from "./streaming";
import { oggOpusWorkerCode } from "./workers/ogg-opus-worker-code";
import { getWorkerCode } from "./workers/workerUrl";

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

describe("detectStreamFormat - URL parsing robustness", () => {
	test("handles URLs with query parameters", () => {
		expect(
			detectStreamFormat(
				"https://cdn.example.com/audio.opus?token=abc123&expires=999",
			),
		).toBe("OggOpus");
		expect(detectStreamFormat("https://cdn.example.com/audio.mp3?v=2")).toBe(
			"Mp3",
		);
	});

	test("handles URLs with fragments", () => {
		expect(detectStreamFormat("https://example.com/audio.flac#section")).toBe(
			"Flac",
		);
	});

	test("handles URLs without extensions as Mp3 fallback", () => {
		expect(detectStreamFormat("https://cdn.example.com/audio/abc123")).toBe(
			"Mp3",
		);
	});

	test("handles relative URLs", () => {
		expect(detectStreamFormat("/sounds/track.opus")).toBe("OggOpus");
		expect(detectStreamFormat("audio.mp3")).toBe("Mp3");
	});

	test("handles blob URLs as Mp3 fallback", () => {
		expect(detectStreamFormat("blob:https://example.com/some-uuid")).toBe(
			"Mp3",
		);
	});
});

describe("formatFromContentType", () => {
	test("maps standard audio content types", () => {
		expect(formatFromContentType("audio/opus")).toBe("OggOpus");
		expect(formatFromContentType("audio/ogg")).toBe("OggOpus");
		expect(formatFromContentType("audio/mpeg")).toBe("Mp3");
		expect(formatFromContentType("audio/mp3")).toBe("Mp3");
		expect(formatFromContentType("audio/mp4")).toBe("Mp4Aac");
		expect(formatFromContentType("audio/aac")).toBe("Aac");
		expect(formatFromContentType("audio/flac")).toBe("Flac");
		expect(formatFromContentType("audio/x-flac")).toBe("Flac");
		expect(formatFromContentType("audio/webm")).toBe("WebmOpus");
	});

	test("maps content types with codec parameters", () => {
		expect(formatFromContentType("audio/ogg; codecs=opus")).toBe("OggOpus");
		expect(formatFromContentType("audio/ogg; codecs=vorbis")).toBe("OggVorbis");
		expect(formatFromContentType("audio/ogg; codecs=flac")).toBe("OggFlac");
		expect(formatFromContentType("audio/webm; codecs=opus")).toBe("WebmOpus");
		expect(formatFromContentType("audio/webm; codecs=vorbis")).toBe(
			"WebmVorbis",
		);
	});

	test("handles case insensitivity and whitespace", () => {
		expect(formatFromContentType("Audio/MPEG")).toBe("Mp3");
		expect(formatFromContentType("  audio/flac  ")).toBe("Flac");
	});

	test("returns null for unknown content types", () => {
		expect(formatFromContentType("text/html")).toBeNull();
		expect(formatFromContentType("application/octet-stream")).toBeNull();
	});
});

describe("detectStreamFormatFromResponse", () => {
	test("returns extension-based format without making a request", async () => {
		const result = await detectStreamFormatFromResponse(
			"https://example.com/audio.opus",
		);
		expect(result).toBe("OggOpus");
	});

	test("falls back to HEAD request for URLs without extensions", async () => {
		// Mock fetch to return a Content-Type header
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_input: unknown, _init: unknown) => {
			return new Response(null, {
				headers: { "Content-Type": "audio/flac" },
			});
		}) as typeof fetch;
		try {
			const result = await detectStreamFormatFromResponse(
				"https://cdn.example.com/audio/abc123",
			);
			expect(result).toBe("Flac");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("falls back to Mp3 when HEAD request fails", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("Network error");
		}) as unknown as typeof fetch;
		try {
			const result = await detectStreamFormatFromResponse(
				"https://cdn.example.com/audio/abc123",
			);
			expect(result).toBe("Mp3");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("falls back to Mp3 when HEAD returns unknown Content-Type", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return new Response(null, {
				headers: { "Content-Type": "application/octet-stream" },
			});
		}) as unknown as typeof fetch;
		try {
			const result = await detectStreamFormatFromResponse(
				"https://cdn.example.com/audio/abc123",
			);
			expect(result).toBe("Mp3");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("oggOpusWorkerCode", () => {
	test("is a non-empty string containing valid IIFE code", () => {
		expect(typeof oggOpusWorkerCode).toBe("string");
		expect(oggOpusWorkerCode.length).toBeGreaterThan(100);
		// Should be IIFE — no module syntax
		expect(oggOpusWorkerCode).not.toMatch(/\bexport\s/);
		expect(oggOpusWorkerCode).not.toMatch(/\bimport\s/);
	});
});

describe("embedded worker code modules", () => {
	const allFormats: StreamFormat[] = [
		"Aac",
		"Flac",
		"Mp3",
		"Mp4Aac",
		"OggFlac",
		"OggOpus",
		"OggVorbis",
		"RawOpusFramed",
		"WebmOpus",
		"WebmVorbis",
	];

	for (const format of allFormats) {
		test(`getWorkerCode("${format}") returns non-empty IIFE code`, async () => {
			const code = await getWorkerCode(format);
			expect(typeof code).toBe("string");
			expect(code.length).toBeGreaterThan(100);
			expect(code).not.toMatch(/\bexport\s/);
			expect(code).not.toMatch(/\bimport\s/);
		});
	}

	test("all embedded worker code files exist in src/workers/", () => {
		const codeFiles = [
			"aac-worker-code.ts",
			"flac-worker-code.ts",
			"mp3-worker-code.ts",
			"mp4-aac-worker-code.ts",
			"ogg-flac-worker-code.ts",
			"ogg-opus-worker-code.ts",
			"ogg-vorbis-worker-code.ts",
			"raw-opus-framed-worker-code.ts",
			"webm-opus-worker-code.ts",
			"webm-vorbis-worker-code.ts",
		];
		for (const file of codeFiles) {
			expect(existsSync(join("src", "workers", file))).toBe(true);
		}
	});
});

describe("createCdnWorkerFactory", () => {
	test("returns a function", () => {
		const factory = createCdnWorkerFactory();
		expect(typeof factory).toBe("function");
	});

	test("workerFileMap contains all StreamFormat values", () => {
		const formats: StreamFormat[] = [
			"Aac",
			"Flac",
			"Mp3",
			"Mp4Aac",
			"OggFlac",
			"OggOpus",
			"OggVorbis",
			"RawOpusFramed",
			"WebmOpus",
			"WebmVorbis",
		];
		for (const format of formats) {
			expect(workerFileMap[format]).toBeDefined();
			expect(typeof workerFileMap[format]).toBe("string");
			expect(workerFileMap[format]).toMatch(/\.min\.js$/);
		}
	});
});
