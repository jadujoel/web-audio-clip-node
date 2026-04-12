import { describe, expect, it } from "bun:test";
import {
	FRAMED_RAW_OPUS_MAGIC,
	createFramedRawOpusStreamState,
	parseFramedRawOpusStream,
} from "../framed-raw-opus";

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function uint32LE(value: number): Uint8Array {
	return new Uint8Array([
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff,
	]);
}

function buildOpusHead(channels = 2, preSkip = 312): Uint8Array {
	const head = new Uint8Array(19);
	head.set(new TextEncoder().encode("OpusHead"), 0);
	head[8] = 1;
	head[9] = channels;
	head[10] = preSkip & 0xff;
	head[11] = (preSkip >>> 8) & 0xff;
	head[12] = 0x80;
	head[13] = 0xbb;
	return head;
}

describe("framed raw Opus transport", () => {
	it("parses header and packets across chunk boundaries", () => {
		const head = buildOpusHead();
		const packetA = new Uint8Array([1, 2, 3, 4]);
		const packetB = new Uint8Array([5, 6, 7]);
		const bytes = concatBytes(
			new TextEncoder().encode(FRAMED_RAW_OPUS_MAGIC),
			uint32LE(head.length),
			head,
			uint32LE(packetA.length),
			packetA,
			uint32LE(packetB.length),
			packetB,
		);
		const state = createFramedRawOpusStreamState();
		const first = parseFramedRawOpusStream(bytes.slice(0, 20), state);
		expect(first.head).toBeNull();
		expect(first.packets).toHaveLength(0);
		const second = parseFramedRawOpusStream(
			concatBytes(first.leftover, bytes.slice(20)),
			state,
		);
		expect(second.head?.channels).toBe(2);
		expect(second.head?.preSkip).toBe(312);
		expect(second.packets).toEqual([packetA, packetB]);
		expect(second.leftover).toHaveLength(0);
	});

	it("rejects streams with the wrong magic header", () => {
		const state = createFramedRawOpusStreamState();
		expect(() =>
			parseFramedRawOpusStream(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), state),
		).toThrow(/FROPUS01/);
	});
});
