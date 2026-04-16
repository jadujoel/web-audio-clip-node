import { describe, expect, test } from "vitest";
import { parseAdtsFrames } from "./aac-adts-decode-worker";

/**
 * Builds a minimal ADTS header (7 bytes, no CRC).
 * profile: 1 = AAC-LC (stored as profile-1 = 0x01 → bits = 0b01)
 * samplingFreqIndex: 3 = 48000 Hz
 * channelConfig: 2 = stereo
 */
function makeAdtsHeader(
	frameLength: number,
	opts?: {
		profile?: number;
		samplingFreqIndex?: number;
		channelConfig?: number;
		protectionAbsent?: boolean;
	},
): Uint8Array {
	const profile = (opts?.profile ?? 2) - 1; // audioObjectType - 1
	const freqIdx = opts?.samplingFreqIndex ?? 3; // 48000 Hz
	const chanCfg = opts?.channelConfig ?? 2; // stereo
	const protectionAbsent = opts?.protectionAbsent ?? true;
	const headerSize = protectionAbsent ? 7 : 9;
	const totalLength = frameLength + headerSize;

	const header = new Uint8Array(headerSize);
	// Byte 0: 0xFF
	header[0] = 0xff;
	// Byte 1: 0xF0 | (ID=0 MPEG-4) | (layer=00) | protection_absent
	header[1] = 0xf0 | (protectionAbsent ? 0x01 : 0x00);
	// Byte 2: profile(2) | sampling_freq_index(4) | private(1) | channel_config_high(1)
	header[2] =
		((profile & 0x03) << 6) | ((freqIdx & 0x0f) << 2) | ((chanCfg >> 2) & 0x01);
	// Byte 3: channel_config_low(2) | original(1) | home(1) | copyright_id(1) | copyright_start(1) | frame_length_high(2)
	header[3] = ((chanCfg & 0x03) << 6) | ((totalLength >> 11) & 0x03);
	// Byte 4: frame_length_mid(8)
	header[4] = (totalLength >> 3) & 0xff;
	// Byte 5: frame_length_low(3) | buffer_fullness_high(5)
	header[5] = ((totalLength & 0x07) << 5) | 0x1f; // buffer fullness = 0x7FF (VBR)
	// Byte 6: buffer_fullness_low(6) | num_aac_frames_minus1(2)
	header[6] = 0xfc; // buffer fullness low = 0x3F, 0 extra frames

	if (!protectionAbsent) {
		// CRC bytes (dummy)
		header[7] = 0x00;
		header[8] = 0x00;
	}

	return header;
}

function makeAdtsFrame(
	payloadSize: number,
	opts?: Parameters<typeof makeAdtsHeader>[1],
): Uint8Array {
	const header = makeAdtsHeader(payloadSize, opts);
	const frame = new Uint8Array(header.length + payloadSize);
	frame.set(header);
	// payload is zeros
	return frame;
}

describe("parseAdtsFrames", () => {
	test("parses a single valid ADTS frame", () => {
		const frame = makeAdtsFrame(100);
		const result = parseAdtsFrames(frame);

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].offset).toBe(0);
		expect(result.frames[0].size).toBe(107); // 7 header + 100 payload
		expect(result.frames[0].sampleRate).toBe(48000);
		expect(result.frames[0].channels).toBe(2);
		expect(result.frames[0].profile).toBe(2); // AAC-LC
		expect(result.frames[0].headerSize).toBe(7);
		expect(result.leftover).toHaveLength(0);
	});

	test("parses multiple consecutive ADTS frames", () => {
		const frame1 = makeAdtsFrame(100);
		const frame2 = makeAdtsFrame(200);
		const buf = new Uint8Array(frame1.length + frame2.length);
		buf.set(frame1);
		buf.set(frame2, frame1.length);

		const result = parseAdtsFrames(buf);

		expect(result.frames).toHaveLength(2);
		expect(result.frames[0].size).toBe(107);
		expect(result.frames[1].size).toBe(207);
		expect(result.frames[1].offset).toBe(107);
		expect(result.leftover).toHaveLength(0);
	});

	test("returns leftover when buffer ends mid-frame", () => {
		const frame = makeAdtsFrame(100);
		// Cut off last 10 bytes
		const partial = frame.slice(0, frame.length - 10);

		const result = parseAdtsFrames(partial);

		expect(result.frames).toHaveLength(0);
		expect(result.leftover).toHaveLength(partial.length);
	});

	test("skips invalid bytes and resyncs to valid frame", () => {
		const garbage = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]);
		const frame = makeAdtsFrame(100);
		const buf = new Uint8Array(garbage.length + frame.length);
		buf.set(garbage);
		buf.set(frame, garbage.length);

		const result = parseAdtsFrames(buf);

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].offset).toBe(garbage.length);
		expect(result.frames[0].size).toBe(107);
		expect(result.leftover).toHaveLength(0);
	});

	test("extracts correct sample rate from different frequency indices", () => {
		// Index 4 = 44100 Hz
		const frame = makeAdtsFrame(50, { samplingFreqIndex: 4 });
		const result = parseAdtsFrames(frame);

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].sampleRate).toBe(44100);
	});

	test("extracts correct channel count", () => {
		const frame = makeAdtsFrame(50, { channelConfig: 1 }); // mono
		const result = parseAdtsFrames(frame);

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].channels).toBe(1);
	});

	test("handles frame with CRC (9-byte header)", () => {
		const frame = makeAdtsFrame(100, { protectionAbsent: false });
		const result = parseAdtsFrames(frame);

		expect(result.frames).toHaveLength(1);
		expect(result.frames[0].size).toBe(109); // 9 header + 100 payload
		expect(result.frames[0].headerSize).toBe(9);
		expect(result.leftover).toHaveLength(0);
	});

	test("returns empty for empty buffer", () => {
		const result = parseAdtsFrames(new Uint8Array(0));
		expect(result.frames).toHaveLength(0);
		expect(result.leftover).toHaveLength(0);
	});

	test("returns empty for buffer too small for header", () => {
		const result = parseAdtsFrames(new Uint8Array([0xff, 0xf1, 0x50]));
		expect(result.frames).toHaveLength(0);
		expect(result.leftover.length).toBeGreaterThan(0);
	});

	test("parses real ADTS file header bytes", async () => {
		const data = new Uint8Array(
			(await fetch("/src/sounds/example.aac").then((r) =>
				r.arrayBuffer(),
			)) as ArrayBuffer,
		);
		const first4k = data.slice(0, 4096);

		const result = parseAdtsFrames(first4k);
		expect(result.frames.length).toBeGreaterThan(0);

		// Verify first frame has reasonable values
		const f = result.frames[0];
		expect(f.sampleRate).toBeGreaterThan(0);
		expect(f.channels).toBeGreaterThanOrEqual(1);
		expect(f.channels).toBeLessThanOrEqual(8);
		expect(f.profile).toBe(2); // AAC-LC
		expect(f.size).toBeGreaterThan(f.headerSize);
	});
});
