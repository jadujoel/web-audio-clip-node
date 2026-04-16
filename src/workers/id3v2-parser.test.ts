import { describe, expect, test } from "vitest";
import { parseId3v2 } from "./id3v2-parser";

function makeId3v2Tag(frames: { id: string; data: Uint8Array }[]): Uint8Array {
	// Build ID3v2.3 tag
	const frameChunks: Uint8Array[] = [];
	for (const frame of frames) {
		const header = new Uint8Array(10);
		// Frame ID (4 bytes)
		for (let i = 0; i < 4; i++) header[i] = frame.id.charCodeAt(i);
		// Frame size (4 bytes, big-endian, non-syncsafe for v2.3)
		const size = frame.data.length;
		header[4] = (size >> 24) & 0xff;
		header[5] = (size >> 16) & 0xff;
		header[6] = (size >> 8) & 0xff;
		header[7] = size & 0xff;
		// Flags = 0
		frameChunks.push(header, frame.data);
	}

	const framesSize = frameChunks.reduce((sum, c) => sum + c.length, 0);

	// Syncsafe integer for tag size
	const tagHeader = new Uint8Array(10);
	tagHeader[0] = 0x49; // 'I'
	tagHeader[1] = 0x44; // 'D'
	tagHeader[2] = 0x33; // '3'
	tagHeader[3] = 3; // version 2.3
	tagHeader[4] = 0; // revision
	tagHeader[5] = 0; // flags
	// Encode framesSize as syncsafe
	tagHeader[6] = (framesSize >> 21) & 0x7f;
	tagHeader[7] = (framesSize >> 14) & 0x7f;
	tagHeader[8] = (framesSize >> 7) & 0x7f;
	tagHeader[9] = framesSize & 0x7f;

	const result = new Uint8Array(10 + framesSize);
	result.set(tagHeader, 0);
	let offset = 10;
	for (const chunk of frameChunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function textFrame(text: string): Uint8Array {
	// UTF-8 encoding (encoding byte = 3)
	const encoder = new TextEncoder();
	const textBytes = encoder.encode(text);
	const frame = new Uint8Array(1 + textBytes.length);
	frame[0] = 3; // UTF-8
	frame.set(textBytes, 1);
	return frame;
}

function latin1TextFrame(text: string): Uint8Array {
	// ISO-8859-1 encoding (encoding byte = 0)
	const frame = new Uint8Array(1 + text.length);
	frame[0] = 0; // Latin-1
	for (let i = 0; i < text.length; i++) frame[i + 1] = text.charCodeAt(i);
	return frame;
}

describe("parseId3v2", () => {
	test("returns null for non-ID3 data", () => {
		const buf = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
		expect(parseId3v2(buf)).toBeNull();
	});

	test("returns null for buffer too small", () => {
		const buf = new Uint8Array([0x49, 0x44, 0x33]);
		expect(parseId3v2(buf)).toBeNull();
	});

	test("parses title and artist from UTF-8 frames", () => {
		const tag = makeId3v2Tag([
			{ id: "TIT2", data: textFrame("Test Song") },
			{ id: "TPE1", data: textFrame("Test Artist") },
		]);
		const metadata = parseId3v2(tag);
		expect(metadata).not.toBeNull();
		expect(metadata?.title).toBe("Test Song");
		expect(metadata?.artist).toBe("Test Artist");
	});

	test("parses album, track, year, genre", () => {
		const tag = makeId3v2Tag([
			{ id: "TALB", data: textFrame("Test Album") },
			{ id: "TRCK", data: textFrame("5/12") },
			{ id: "TYER", data: textFrame("2024") },
			{ id: "TCON", data: textFrame("Rock") },
		]);
		const metadata = parseId3v2(tag);
		expect(metadata).not.toBeNull();
		expect(metadata?.album).toBe("Test Album");
		expect(metadata?.trackNumber).toBe(5);
		expect(metadata?.year).toBe(2024);
		expect(metadata?.genre).toBe("Rock");
	});

	test("parses Latin-1 encoded text", () => {
		const tag = makeId3v2Tag([
			{ id: "TIT2", data: latin1TextFrame("Hello World") },
		]);
		const metadata = parseId3v2(tag);
		expect(metadata?.title).toBe("Hello World");
	});

	test("parses all common fields", () => {
		const tag = makeId3v2Tag([
			{ id: "TIT2", data: textFrame("My Song") },
			{ id: "TPE1", data: textFrame("My Artist") },
			{ id: "TALB", data: textFrame("My Album") },
			{ id: "TRCK", data: textFrame("3") },
			{ id: "TDRC", data: textFrame("2023") },
			{ id: "TCON", data: textFrame("Pop") },
		]);
		const metadata = parseId3v2(tag);
		expect(metadata).not.toBeNull();
		expect(metadata?.title).toBe("My Song");
		expect(metadata?.artist).toBe("My Artist");
		expect(metadata?.album).toBe("My Album");
		expect(metadata?.trackNumber).toBe(3);
		expect(metadata?.year).toBe(2023);
		expect(metadata?.genre).toBe("Pop");
	});

	test("returns null for empty tag (no frames)", () => {
		// ID3v2 header with 0 size
		const tag = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
		expect(parseId3v2(tag)).toBeNull();
	});
});
