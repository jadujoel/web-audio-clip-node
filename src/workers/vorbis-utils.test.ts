import { describe, expect, test } from "vitest";
import {
	buildXiphExtradata,
	isVorbisStream,
	parseVorbisIdentification,
} from "./vorbis-utils";

function makeVorbisIdHeader(
	channels = 2,
	sampleRate = 44100,
	bitrateNominal = 128000,
): Uint8Array {
	const buf = new Uint8Array(30);
	// "\x01vorbis" magic
	buf.set([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 0);
	// vorbis_version = 0 (bytes 7-10)
	// channels (byte 11)
	buf[11] = channels;
	// sampleRate (bytes 12-15, u32LE)
	buf[12] = sampleRate & 0xff;
	buf[13] = (sampleRate >> 8) & 0xff;
	buf[14] = (sampleRate >> 16) & 0xff;
	buf[15] = (sampleRate >> 24) & 0xff;
	// bitrate_maximum (bytes 16-19) = 0
	// bitrate_nominal (bytes 20-23, i32LE)
	buf[20] = bitrateNominal & 0xff;
	buf[21] = (bitrateNominal >> 8) & 0xff;
	buf[22] = (bitrateNominal >> 16) & 0xff;
	buf[23] = (bitrateNominal >> 24) & 0xff;
	// bitrate_minimum (bytes 24-27) = 0
	// blocksize (byte 28)
	buf[28] = 0x36; // blocksize_0=6, blocksize_1=3 (arbitrary)
	// framing_flag (byte 29) must be 1
	buf[29] = 1;
	return buf;
}

describe("isVorbisStream", () => {
	test("returns true for valid Vorbis identification packet", () => {
		expect(isVorbisStream(makeVorbisIdHeader())).toBe(true);
	});

	test("returns false for Opus packet", () => {
		const opusHead = new TextEncoder().encode("OpusHead");
		const packet = new Uint8Array(19);
		packet.set(opusHead, 0);
		expect(isVorbisStream(packet)).toBe(false);
	});

	test("returns false for too-short buffer", () => {
		expect(isVorbisStream(new Uint8Array(3))).toBe(false);
	});

	test("returns false for empty buffer", () => {
		expect(isVorbisStream(new Uint8Array(0))).toBe(false);
	});
});

describe("parseVorbisIdentification", () => {
	test("parses standard 44100 Hz stereo header", () => {
		const result = parseVorbisIdentification(
			makeVorbisIdHeader(2, 44100, 128000),
		);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.channels).toBe(2);
		expect(result.sampleRate).toBe(44100);
		expect(result.bitrateNominal).toBe(128000);
	});

	test("parses 48000 Hz mono header", () => {
		const result = parseVorbisIdentification(
			makeVorbisIdHeader(1, 48000, 96000),
		);
		if (result == null) throw new Error("Expected non-null result");
		expect(result.channels).toBe(1);
		expect(result.sampleRate).toBe(48000);
		expect(result.bitrateNominal).toBe(96000);
	});

	test("returns null for too-short packet", () => {
		expect(parseVorbisIdentification(new Uint8Array(29))).toBeNull();
	});

	test("returns null for wrong magic", () => {
		const buf = makeVorbisIdHeader();
		buf[0] = 0x00; // break magic
		expect(parseVorbisIdentification(buf)).toBeNull();
	});

	test("returns null for non-zero vorbis_version", () => {
		const buf = makeVorbisIdHeader();
		buf[7] = 1; // non-zero version
		expect(parseVorbisIdentification(buf)).toBeNull();
	});

	test("returns null for zero channels", () => {
		const buf = makeVorbisIdHeader(0);
		expect(parseVorbisIdentification(buf)).toBeNull();
	});

	test("returns null if framing flag is not set", () => {
		const buf = makeVorbisIdHeader();
		buf[29] = 0;
		expect(parseVorbisIdentification(buf)).toBeNull();
	});

	test("parses real OGG Vorbis file header", async () => {
		const data = await fetch("/src/sounds/example-vorbis.ogg").then((r) =>
			r.arrayBuffer(),
		);
		const buf = new Uint8Array(data);
		// Skip OGG page header to find first packet
		// OGG header: "OggS" (4) + version (1) + headerType (1) + granulePos (8) + serial (4) + pageSeq (4) + crc (4) + segCount (1) = 27 bytes + segment table
		if (
			buf[0] === 0x4f &&
			buf[1] === 0x67 &&
			buf[2] === 0x67 &&
			buf[3] === 0x53
		) {
			const segCount = buf[26];
			const dataStart = 27 + segCount;
			const packet = buf.slice(dataStart, dataStart + 30);
			expect(isVorbisStream(packet)).toBe(true);
			const result = parseVorbisIdentification(packet);
			if (result == null) throw new Error("Expected non-null result");
			expect(result.channels).toBe(2);
			expect(result.sampleRate).toBe(44100);
		}
	});
});

describe("buildXiphExtradata", () => {
	test("builds correct extradata for small headers", () => {
		const id = new Uint8Array(30);
		const comment = new Uint8Array(20);
		const setup = new Uint8Array(100);

		const result = buildXiphExtradata(id, comment, setup);

		// Byte 0: 0x02
		expect(result[0]).toBe(0x02);
		// Xiph-laced size of id (30 < 255, so 1 byte)
		expect(result[1]).toBe(30);
		// Xiph-laced size of comment (20 < 255, so 1 byte)
		expect(result[2]).toBe(20);
		// Total = 1 + 1 + 1 + 30 + 20 + 100 = 153
		expect(result.length).toBe(153);
	});

	test("builds correct extradata for large headers requiring lacing", () => {
		const id = new Uint8Array(300); // 1×255 + 45 = 2 bytes laced
		const comment = new Uint8Array(10);
		const setup = new Uint8Array(50);

		const result = buildXiphExtradata(id, comment, setup);

		// Byte 0: 0x02
		expect(result[0]).toBe(0x02);
		// Xiph-laced size of id: 255, 45
		expect(result[1]).toBe(255);
		expect(result[2]).toBe(45);
		// Xiph-laced size of comment: 10
		expect(result[3]).toBe(10);
		// Total = 1 + 2 + 1 + 300 + 10 + 50 = 364
		expect(result.length).toBe(364);
	});

	test("reconstructed extradata contains original data", () => {
		const id = makeVorbisIdHeader();
		const comment = new Uint8Array([
			0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1,
		]);
		const setup = new Uint8Array(64).fill(0xaa);

		const result = buildXiphExtradata(id, comment, setup);

		// After the lacing bytes, we should find the original data
		// 1 byte (0x02) + 1 byte (30) + 1 byte (16) = 3 bytes header
		const offset = 3;
		expect(Array.from(result.subarray(offset, offset + 30))).toEqual(
			Array.from(id),
		);
		expect(Array.from(result.subarray(offset + 30, offset + 30 + 16))).toEqual(
			Array.from(comment),
		);
		expect(Array.from(result.subarray(offset + 30 + 16))).toEqual(
			Array.from(setup),
		);
	});
});
