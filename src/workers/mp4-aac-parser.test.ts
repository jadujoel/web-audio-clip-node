import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import {
	_buildSampleMap,
	_codecStringFromAOT,
	_parseEsds,
	_parseStco,
	_parseStsc,
	_parseStsz,
	_parseStts,
	_readBoxHeader,
	type Mp4ParseResult,
	parseMp4,
} from "./mp4-aac-parser";

describe("readBoxHeader", () => {
	test("reads a standard 8-byte box header", () => {
		const buf = new Uint8Array(16);
		const view = new DataView(buf.buffer);
		view.setUint32(0, 100); // size
		buf[4] = 0x66; // 'f'
		buf[5] = 0x74; // 't'
		buf[6] = 0x79; // 'y'
		buf[7] = 0x70; // 'p'

		const result = _readBoxHeader(buf, 0);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("ftyp");
		expect(result?.size).toBe(100);
		expect(result?.headerSize).toBe(8);
	});

	test("returns null for insufficient buffer", () => {
		const buf = new Uint8Array(4);
		expect(_readBoxHeader(buf, 0)).toBeNull();
	});

	test("handles size=0 (extends to EOF)", () => {
		const buf = new Uint8Array(32);
		// size = 0
		buf[4] = 0x6d; // 'm'
		buf[5] = 0x64; // 'd'
		buf[6] = 0x61; // 'a'
		buf[7] = 0x74; // 't'

		const result = _readBoxHeader(buf, 0);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("mdat");
		expect(result?.size).toBe(32); // extends to end of buffer
	});
});

describe("parseStsz", () => {
	test("parses constant sample size", () => {
		// FullBox: version(1) + flags(3) + sampleSize(4) + sampleCount(4) = 12
		const buf = new Uint8Array(12);
		const view = new DataView(buf.buffer);
		view.setUint32(4, 512); // constant sample size
		view.setUint32(8, 3); // 3 samples

		const sizes = _parseStsz(buf);
		expect(sizes).toEqual([512, 512, 512]);
	});

	test("parses variable sample sizes", () => {
		const buf = new Uint8Array(24); // 12 header + 3*4 entries
		const view = new DataView(buf.buffer);
		view.setUint32(4, 0); // variable
		view.setUint32(8, 3); // 3 samples
		view.setUint32(12, 100);
		view.setUint32(16, 200);
		view.setUint32(20, 300);

		const sizes = _parseStsz(buf);
		expect(sizes).toEqual([100, 200, 300]);
	});
});

describe("parseStco", () => {
	test("parses chunk offsets", () => {
		const buf = new Uint8Array(16);
		const view = new DataView(buf.buffer);
		view.setUint32(4, 2); // 2 entries
		view.setUint32(8, 1000);
		view.setUint32(12, 5000);

		const offsets = _parseStco(buf);
		expect(offsets).toEqual([1000, 5000]);
	});
});

describe("parseStsc", () => {
	test("parses sample-to-chunk mapping", () => {
		const buf = new Uint8Array(20); // 8 header + 1*12 entry
		const view = new DataView(buf.buffer);
		view.setUint32(4, 1); // 1 entry
		view.setUint32(8, 1); // first_chunk
		view.setUint32(12, 10); // samples_per_chunk
		view.setUint32(16, 1); // sample_description_index

		const entries = _parseStsc(buf);
		expect(entries).toHaveLength(1);
		expect(entries[0].firstChunk).toBe(1);
		expect(entries[0].samplesPerChunk).toBe(10);
	});
});

describe("parseStts", () => {
	test("parses time-to-sample entries", () => {
		const buf = new Uint8Array(16); // 8 header + 1*8 entry
		const view = new DataView(buf.buffer);
		view.setUint32(4, 1); // 1 entry
		view.setUint32(8, 100); // sample_count
		view.setUint32(12, 1024); // sample_delta

		const entries = _parseStts(buf);
		expect(entries).toHaveLength(1);
		expect(entries[0].sampleCount).toBe(100);
		expect(entries[0].sampleDelta).toBe(1024);
	});
});

describe("codecStringFromAOT", () => {
	test("returns correct codec strings", () => {
		expect(_codecStringFromAOT(2)).toBe("mp4a.40.2");
		expect(_codecStringFromAOT(5)).toBe("mp4a.40.5");
		expect(_codecStringFromAOT(29)).toBe("mp4a.40.29");
		expect(_codecStringFromAOT(23)).toBe("mp4a.40.23");
	});
});

describe("buildSampleMap", () => {
	test("builds sample map from sample tables", () => {
		const stsz = [100, 200, 300];
		const stco = [1000]; // 1 chunk
		const stsc = [{ firstChunk: 1, samplesPerChunk: 3 }];
		const stts = [{ sampleCount: 3, sampleDelta: 1024 }];
		const timescale = 44100;

		const samples = _buildSampleMap(stsz, stco, stsc, stts, timescale);
		expect(samples).toHaveLength(3);
		expect(samples[0].byteOffset).toBe(1000);
		expect(samples[0].size).toBe(100);
		expect(samples[0].timestampUs).toBe(0);
		expect(samples[1].byteOffset).toBe(1100);
		expect(samples[1].size).toBe(200);
		// timestamp of second sample: 1024/44100 * 1e6 ≈ 23220 us
		expect(samples[1].timestampUs).toBeGreaterThan(0);
		expect(samples[2].byteOffset).toBe(1300);
		expect(samples[2].size).toBe(300);
	});

	test("handles multiple chunks", () => {
		const stsz = [100, 100, 200, 200];
		const stco = [1000, 5000]; // 2 chunks
		const stsc = [{ firstChunk: 1, samplesPerChunk: 2 }];
		const stts = [{ sampleCount: 4, sampleDelta: 1024 }];
		const timescale = 48000;

		const samples = _buildSampleMap(stsz, stco, stsc, stts, timescale);
		expect(samples).toHaveLength(4);
		expect(samples[0].byteOffset).toBe(1000);
		expect(samples[1].byteOffset).toBe(1100);
		expect(samples[2].byteOffset).toBe(5000);
		expect(samples[3].byteOffset).toBe(5200);
	});
});

describe("parseEsds", () => {
	test("extracts AudioSpecificConfig from valid esds data", () => {
		// Build a minimal esds with version+flags(4) + descriptors
		const esds = new Uint8Array([
			0x00,
			0x00,
			0x00,
			0x00, // version + flags
			0x03, // ES_Descriptor tag
			0x19, // length (25 bytes)
			0x00,
			0x01, // ES_ID
			0x00, // stream priority
			0x04, // DecoderConfigDescriptor tag
			0x11, // length (17 bytes)
			0x40, // objectTypeIndication (AAC)
			0x15, // streamType (audio)
			0x00,
			0x00,
			0x00, // bufferSizeDB
			0x00,
			0x01,
			0xf4,
			0x00, // maxBitrate
			0x00,
			0x01,
			0xf4,
			0x00, // avgBitrate
			0x05, // DecoderSpecificInfo tag
			0x02, // length (2 bytes)
			0x12,
			0x10, // AudioSpecificConfig: AAC-LC, 44100 Hz, stereo
		]);

		const result = _parseEsds(esds);
		expect(result).not.toBeNull();
		expect(result?.audioObjectType).toBe(2); // AAC-LC
		expect(result?.audioSpecificConfig).toEqual(new Uint8Array([0x12, 0x10]));
	});

	test("returns null for empty data", () => {
		expect(_parseEsds(new Uint8Array(0))).toBeNull();
	});
});

describe("parseMp4 integration", () => {
	test("parses real M4A file", () => {
		const data = new Uint8Array(
			fs.readFileSync("src/sounds/example.m4a").buffer,
		);

		const result = parseMp4(data);
		expect(result).not.toBeNull();

		const r = result as Mp4ParseResult;
		expect(r.track.codecString).toBe("mp4a.40.2");
		expect(r.track.sampleRate).toBeGreaterThan(0);
		expect(r.track.channelCount).toBeGreaterThanOrEqual(1);
		expect(r.track.channelCount).toBeLessThanOrEqual(8);
		expect(r.track.audioSpecificConfig.length).toBeGreaterThan(0);
		expect(r.track.samplesPerFrame).toBe(1024);

		// Should have many samples
		expect(r.samples.length).toBeGreaterThan(100);

		// First sample timestamp should be 0
		expect(r.samples[0].timestampUs).toBe(0);

		// Timestamps should be monotonically increasing
		for (let i = 1; i < r.samples.length; i++) {
			expect(r.samples[i].timestampUs).toBeGreaterThan(
				r.samples[i - 1].timestampUs,
			);
		}

		// All samples should have non-zero size
		for (const sample of r.samples) {
			expect(sample.size).toBeGreaterThan(0);
		}

		// mdat should be present
		expect(r.mdatOffset).toBeGreaterThan(0);
		expect(r.mdatSize).toBeGreaterThan(0);
	});
});
