import { describe, expect, test } from "bun:test";
import { isFlacStream, parseOggFlacHeader } from "./ogg-flac-decode-worker";

/**
 * Build a minimal OGG FLAC identification header (51 bytes).
 */
function makeOggFlacIdHeader(opts?: {
	sampleRate?: number;
	channels?: number;
	bitsPerSample?: number;
	totalSamples?: number;
	numberOfHeaderPackets?: number;
}): Uint8Array {
	const {
		sampleRate = 44100,
		channels = 2,
		bitsPerSample = 16,
		totalSamples = 0,
		numberOfHeaderPackets = 0,
	} = opts ?? {};

	const buf = new Uint8Array(51);

	// Byte 0: 0x7F
	buf[0] = 0x7f;
	// Bytes 1-4: "FLAC"
	buf[1] = 0x46; // F
	buf[2] = 0x4c; // L
	buf[3] = 0x41; // A
	buf[4] = 0x43; // C
	// Byte 5: major version = 1
	buf[5] = 1;
	// Byte 6: minor version = 0
	buf[6] = 0;
	// Bytes 7-8: numberOfHeaderPackets (big-endian u16)
	buf[7] = (numberOfHeaderPackets >> 8) & 0xff;
	buf[8] = numberOfHeaderPackets & 0xff;
	// Bytes 9-12: "fLaC"
	buf[9] = 0x66;
	buf[10] = 0x4c;
	buf[11] = 0x61;
	buf[12] = 0x43;
	// Bytes 13-16: METADATA_BLOCK_HEADER (type 0 = STREAMINFO, is_last = 1, length = 34)
	buf[13] = 0x80; // is_last=1, type=0
	buf[14] = 0;
	buf[15] = 0;
	buf[16] = 34;
	// Bytes 17-50: STREAMINFO (34 bytes)
	const si = 17;
	// min/max block size
	buf[si + 0] = 0x10;
	buf[si + 1] = 0x00;
	buf[si + 2] = 0x10;
	buf[si + 3] = 0x00;
	// sample rate (20 bits): bytes si+10 to si+12
	buf[si + 10] = (sampleRate >> 12) & 0xff;
	buf[si + 11] = (sampleRate >> 4) & 0xff;
	buf[si + 12] =
		((sampleRate & 0xf) << 4) |
		(((channels - 1) & 0x7) << 1) |
		(((bitsPerSample - 1) >> 4) & 0x1);
	buf[si + 13] =
		(((bitsPerSample - 1) & 0xf) << 4) | ((totalSamples / 0x100000000) & 0xf);
	const lowSamples = totalSamples >>> 0;
	buf[si + 14] = (lowSamples >> 24) & 0xff;
	buf[si + 15] = (lowSamples >> 16) & 0xff;
	buf[si + 16] = (lowSamples >> 8) & 0xff;
	buf[si + 17] = lowSamples & 0xff;

	return buf;
}

describe("isFlacStream", () => {
	test("returns true for valid OGG FLAC identification header", () => {
		expect(isFlacStream(makeOggFlacIdHeader())).toBe(true);
	});

	test("returns false for Vorbis packet", () => {
		const vorbis = new Uint8Array(30);
		vorbis[0] = 0x01;
		vorbis.set(new TextEncoder().encode("vorbis"), 1);
		expect(isFlacStream(vorbis)).toBe(false);
	});

	test("returns false for Opus packet", () => {
		const opus = new Uint8Array(19);
		opus.set(new TextEncoder().encode("OpusHead"), 0);
		expect(isFlacStream(opus)).toBe(false);
	});

	test("returns false for too-short buffer", () => {
		expect(isFlacStream(new Uint8Array(4))).toBe(false);
	});

	test("returns false for empty buffer", () => {
		expect(isFlacStream(new Uint8Array(0))).toBe(false);
	});
});

describe("parseOggFlacHeader", () => {
	test("parses standard 44100 Hz stereo header", () => {
		const result = parseOggFlacHeader(makeOggFlacIdHeader());
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(44100);
		expect(result.channels).toBe(2);
		expect(result.bitsPerSample).toBe(16);
		expect(result.numberOfHeaderPackets).toBe(0);
	});

	test("parses 48000 Hz mono 24-bit header", () => {
		const result = parseOggFlacHeader(
			makeOggFlacIdHeader({
				sampleRate: 48000,
				channels: 1,
				bitsPerSample: 24,
			}),
		);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.sampleRate).toBe(48000);
		expect(result.channels).toBe(1);
		expect(result.bitsPerSample).toBe(24);
	});

	test("extracts totalSamples", () => {
		const result = parseOggFlacHeader(
			makeOggFlacIdHeader({ totalSamples: 5292000 }),
		);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.totalSamples).toBe(5292000);
	});

	test("reads numberOfHeaderPackets", () => {
		const result = parseOggFlacHeader(
			makeOggFlacIdHeader({ numberOfHeaderPackets: 3 }),
		);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.numberOfHeaderPackets).toBe(3);
	});

	test("description starts with fLaC", () => {
		const result = parseOggFlacHeader(makeOggFlacIdHeader());
		if (result == null) throw new Error("Expected non-null result");
		expect(result.descriptionBytes[0]).toBe(0x66); // f
		expect(result.descriptionBytes[1]).toBe(0x4c); // L
		expect(result.descriptionBytes[2]).toBe(0x61); // a
		expect(result.descriptionBytes[3]).toBe(0x43); // C
		expect(result.descriptionBytes.length).toBe(42);
	});

	test("returns null for too-short packet", () => {
		expect(parseOggFlacHeader(new Uint8Array(50))).toBeNull();
	});

	test("returns null for wrong magic", () => {
		const buf = makeOggFlacIdHeader();
		buf[0] = 0x00;
		expect(parseOggFlacHeader(buf)).toBeNull();
	});

	test("returns null for missing fLaC in packet", () => {
		const buf = makeOggFlacIdHeader();
		buf[9] = 0x00; // break "fLaC"
		expect(parseOggFlacHeader(buf)).toBeNull();
	});

	test("parses real OGG FLAC file header", async () => {
		const data = await Bun.file("src/sounds/example-flac.oga").arrayBuffer();
		const buf = new Uint8Array(data);
		// Find first OGG page and extract first packet
		if (
			buf[0] === 0x4f &&
			buf[1] === 0x67 &&
			buf[2] === 0x67 &&
			buf[3] === 0x53
		) {
			const segCount = buf[26];
			const dataStart = 27 + segCount;
			// Read segment sizes to determine first packet size
			let firstPacketSize = 0;
			for (let i = 0; i < segCount; i++) {
				firstPacketSize += buf[27 + i];
				if (buf[27 + i] < 255) break;
			}
			const packet = buf.slice(dataStart, dataStart + firstPacketSize);
			expect(isFlacStream(packet)).toBe(true);
			const result = parseOggFlacHeader(packet);
			if (result == null) throw new Error("Expected non-null result");
			expect(result.sampleRate).toBe(44100);
			expect(result.channels).toBe(2);
			expect(result.bitsPerSample).toBe(24);
			expect(result.totalSamples).toBeGreaterThanOrEqual(0);
		}
	});
});
