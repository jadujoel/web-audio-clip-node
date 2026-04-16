import { describe, expect, test } from "vitest";
import { findFlacFrames, parseFlacMetadata } from "./flac-decode-worker";

function makeFlacBuffer(opts?: {
	isLast?: boolean;
	extraMetaBlocks?: { type: number; data: Uint8Array }[];
	sampleRate?: number;
	channels?: number;
	bitsPerSample?: number;
	totalSamples?: number;
}): Uint8Array {
	const {
		isLast: onlyStreamInfo = true,
		extraMetaBlocks = [],
		sampleRate = 44100,
		channels = 2,
		bitsPerSample = 16,
		totalSamples = 0,
	} = opts ?? {};

	// STREAMINFO: 34 bytes
	const streaminfo = new Uint8Array(34);
	// min/max block size (bytes 0-3)
	streaminfo[0] = 0x10;
	streaminfo[1] = 0x00; // min block = 4096
	streaminfo[2] = 0x10;
	streaminfo[3] = 0x00; // max block = 4096
	// min/max frame size (bytes 4-9) = 0 (unknown)
	// sample rate (20 bits): bytes 10-12 (top 20 bits)
	streaminfo[10] = (sampleRate >> 12) & 0xff;
	streaminfo[11] = (sampleRate >> 4) & 0xff;
	streaminfo[12] =
		((sampleRate & 0xf) << 4) |
		(((channels - 1) & 0x7) << 1) |
		(((bitsPerSample - 1) >> 4) & 0x1);
	streaminfo[13] =
		(((bitsPerSample - 1) & 0xf) << 4) | ((totalSamples / 0x100000000) & 0xf);
	const lowSamples = totalSamples >>> 0;
	streaminfo[14] = (lowSamples >> 24) & 0xff;
	streaminfo[15] = (lowSamples >> 16) & 0xff;
	streaminfo[16] = (lowSamples >> 8) & 0xff;
	streaminfo[17] = lowSamples & 0xff;
	// MD5 (bytes 18-33) = zeros

	const metaBlocks: Uint8Array[] = [];

	// STREAMINFO block header
	const hasExtra = extraMetaBlocks.length > 0;
	const siIsLast = onlyStreamInfo && !hasExtra;
	const siHeader = new Uint8Array(4);
	siHeader[0] = (siIsLast ? 0x80 : 0x00) | 0x00; // type 0 = STREAMINFO
	siHeader[1] = 0;
	siHeader[2] = 0;
	siHeader[3] = 34;
	metaBlocks.push(siHeader, streaminfo);

	for (let i = 0; i < extraMetaBlocks.length; i++) {
		const block = extraMetaBlocks[i];
		const last = i === extraMetaBlocks.length - 1;
		const hdr = new Uint8Array(4);
		hdr[0] = (last ? 0x80 : 0x00) | (block.type & 0x7f);
		hdr[1] = (block.data.length >> 16) & 0xff;
		hdr[2] = (block.data.length >> 8) & 0xff;
		hdr[3] = block.data.length & 0xff;
		metaBlocks.push(hdr, block.data);
	}

	// Calculate total
	let totalLen = 4; // "fLaC"
	for (const b of metaBlocks) totalLen += b.length;

	const result = new Uint8Array(totalLen);
	// "fLaC" magic
	result.set([0x66, 0x4c, 0x61, 0x43], 0);
	let offset = 4;
	for (const b of metaBlocks) {
		result.set(b, offset);
		offset += b.length;
	}
	return result;
}

describe("parseFlacMetadata", () => {
	test("parses standard 44100 Hz stereo FLAC", () => {
		const buf = makeFlacBuffer({ sampleRate: 44100, channels: 2 });
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(44100);
		expect(result.channels).toBe(2);
		expect(result.bitsPerSample).toBe(16);
		expect(result.audioDataOffset).toBe(buf.length);
	});

	test("parses 48000 Hz mono FLAC", () => {
		const buf = makeFlacBuffer({
			sampleRate: 48000,
			channels: 1,
			bitsPerSample: 24,
		});
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(48000);
		expect(result.channels).toBe(1);
		expect(result.bitsPerSample).toBe(24);
	});

	test("parses 96000 Hz 5.1 channel FLAC", () => {
		const buf = makeFlacBuffer({
			sampleRate: 96000,
			channels: 6,
			bitsPerSample: 24,
		});
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(96000);
		expect(result.channels).toBe(6);
		expect(result.bitsPerSample).toBe(24);
	});

	test("extracts totalSamples", () => {
		const buf = makeFlacBuffer({ totalSamples: 5292000 });
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.totalSamples).toBe(5292000);
	});

	test("skips extra metadata blocks (padding, vorbis comment)", () => {
		const padding = new Uint8Array(256); // PADDING block
		const comment = new Uint8Array(16); // VORBIS_COMMENT stub
		const buf = makeFlacBuffer({
			isLast: false,
			extraMetaBlocks: [
				{ type: 1, data: padding },
				{ type: 4, data: comment },
			],
		});
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(44100);
		// audioDataOffset should be after all metadata blocks
		expect(result.audioDataOffset).toBe(buf.length);
		// descriptionBytes should include all metadata
		expect(result.descriptionBytes.length).toBe(buf.length);
	});

	test("returns description bytes starting with fLaC", () => {
		const buf = makeFlacBuffer();
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.descriptionBytes[0]).toBe(0x66); // 'f'
		expect(result.descriptionBytes[1]).toBe(0x4c); // 'L'
		expect(result.descriptionBytes[2]).toBe(0x61); // 'a'
		expect(result.descriptionBytes[3]).toBe(0x43); // 'C'
	});

	test("returns null for wrong magic", () => {
		const buf = makeFlacBuffer();
		buf[0] = 0x00;
		expect(parseFlacMetadata(buf)).toBeNull();
	});

	test("returns null for too-short buffer", () => {
		expect(parseFlacMetadata(new Uint8Array(41))).toBeNull();
	});

	test("returns null for empty buffer", () => {
		expect(parseFlacMetadata(new Uint8Array(0))).toBeNull();
	});

	test("returns null if first block is not STREAMINFO", () => {
		const buf = makeFlacBuffer();
		buf[4] = 0x81; // type 1 = PADDING with is_last
		expect(parseFlacMetadata(buf)).toBeNull();
	});

	test("parses real FLAC file header", async () => {
		const data = await fetch("/src/sounds/example.flac").then((r) =>
			r.arrayBuffer(),
		);
		const buf = new Uint8Array(data);
		const result = parseFlacMetadata(buf);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(44100);
		expect(result.channels).toBe(2);
		expect(result.bitsPerSample).toBe(24);
		expect(result.totalSamples).toBeGreaterThan(0);
		expect(result.audioDataOffset).toBeGreaterThan(42);
		expect(result.descriptionBytes.length).toBe(result.audioDataOffset);
	});
});

describe("findFlacFrames", () => {
	test("finds no frames in empty buffer", () => {
		const result = findFlacFrames(new Uint8Array(0));
		expect(result.frames).toEqual([]);
		expect(result.leftover.length).toBe(0);
	});

	test("finds no frames in buffer without sync codes", () => {
		const buf = new Uint8Array(100).fill(0x42);
		const result = findFlacFrames(buf);
		expect(result.frames).toEqual([]);
		expect(result.leftover.length).toBe(100);
	});

	test("finds frames between sync codes (0xFFF8)", () => {
		// Two frames: sync1 + 8 bytes, sync2 + 8 bytes
		const buf = new Uint8Array(20);
		buf[0] = 0xff;
		buf[1] = 0xf8; // sync 1
		buf[10] = 0xff;
		buf[11] = 0xf8; // sync 2
		const result = findFlacFrames(buf);
		expect(result.frames.length).toBe(1);
		expect(result.frames[0].length).toBe(10); // bytes 0-9
		expect(result.leftover.length).toBe(10); // bytes 10-19
	});

	test("finds frames with variable block size sync (0xFFF9)", () => {
		const buf = new Uint8Array(30);
		buf[0] = 0xff;
		buf[1] = 0xf9; // sync 1
		buf[10] = 0xff;
		buf[11] = 0xf9; // sync 2
		buf[20] = 0xff;
		buf[21] = 0xf9; // sync 3
		const result = findFlacFrames(buf);
		expect(result.frames.length).toBe(2);
		expect(result.frames[0].length).toBe(10);
		expect(result.frames[1].length).toBe(10);
		expect(result.leftover.length).toBe(10);
	});

	test("handles mixed sync codes (0xFFF8 and 0xFFF9)", () => {
		const buf = new Uint8Array(20);
		buf[0] = 0xff;
		buf[1] = 0xf8;
		buf[10] = 0xff;
		buf[11] = 0xf9;
		const result = findFlacFrames(buf);
		expect(result.frames.length).toBe(1);
		expect(result.leftover.length).toBe(10);
	});

	test("single sync code returns no frames, entire buffer as leftover", () => {
		const buf = new Uint8Array(10);
		buf[0] = 0xff;
		buf[1] = 0xf8;
		const result = findFlacFrames(buf);
		expect(result.frames.length).toBe(0);
		expect(result.leftover.length).toBe(10);
	});

	test("finds frames in real FLAC audio data", async () => {
		const data = await fetch("/src/sounds/example.flac").then((r) =>
			r.arrayBuffer(),
		);
		const buf = new Uint8Array(data);
		const meta = parseFlacMetadata(buf);
		if (meta == null) throw new Error("Expected non-null metadata");
		const audioData = buf.subarray(meta.audioDataOffset);
		const result = findFlacFrames(audioData);
		expect(result.frames.length).toBeGreaterThan(0);
		// Verify first frame starts with sync code
		expect(result.frames[0][0]).toBe(0xff);
		expect(result.frames[0][1] & 0xfe).toBe(0xf8);
	});
});
