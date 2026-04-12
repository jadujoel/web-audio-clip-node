import { describe, expect, it } from "bun:test";
import {
	appendWebmOpusBytes,
	createWebmOpusParserState,
	processWebmOpusElements,
	type WebmElementDetail,
} from "../../../src/workers/webm-opus-parser";

function detail<T extends object>(base: T): T & WebmElementDetail {
	return {
		data: new Uint8Array(0),
		...base,
		name: (base as { name?: string }).name ?? "",
	} as T & WebmElementDetail;
}

function buildOpusHead(channels = 2, preSkip = 312): Uint8Array {
	const head = new Uint8Array(19);
	head.set(new TextEncoder().encode("OpusHead"), 0);
	head[8] = 1;
	head[9] = channels;
	head[10] = preSkip & 0xff;
	head[11] = (preSkip >>> 8) & 0xff;
	return head;
}

function buildSimpleBlock(trackNumber: number, timecode: number, packet: Uint8Array): Uint8Array {
	const out = new Uint8Array(4 + packet.length);
	out[0] = 0x80 | trackNumber;
	out[1] = (timecode >>> 8) & 0xff;
	out[2] = timecode & 0xff;
	out[3] = 0x80;
	out.set(packet, 4);
	return out;
}

function encodeVint(value: number): number[] {
	for (let length = 1; length <= 4; length++) {
		const maxValue = 2 ** (7 * length) - 2;
		if (value <= maxValue) {
			const out = new Array<number>(length).fill(0);
			let remaining = value;
			for (let index = length - 1; index >= 0; index--) {
				out[index] = remaining & 0xff;
				remaining >>>= 8;
			}
			out[0] |= 1 << (8 - length);
			return out;
		}
	}
	throw new Error("value too large for test vint");
}

function encodeUnsigned(value: number): Uint8Array {
	if (value === 0) return new Uint8Array([0]);
	const bytes: number[] = [];
	let remaining = value;
	while (remaining > 0) {
		bytes.unshift(remaining & 0xff);
		remaining >>>= 8;
	}
	return new Uint8Array(bytes);
}

function ebml(id: number[], data: Uint8Array): Uint8Array {
	return new Uint8Array([...id, ...encodeVint(data.length), ...data]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function buildMinimalWebmStream(packet: Uint8Array): Uint8Array {
	const opusHead = buildOpusHead();
	const trackEntry = ebml(
		[0xae],
		concatBytes(
			ebml([0xd7], new Uint8Array([1])),
			ebml([0x83], new Uint8Array([2])),
			ebml([0x86], new TextEncoder().encode("A_OPUS")),
			ebml([0x63, 0xa2], opusHead),
			ebml([0x56, 0xaa], encodeUnsigned(6_500_000)),
			ebml([0xe1], ebml([0x9f], new Uint8Array([2]))),
		),
	);
	const tracks = ebml([0x16, 0x54, 0xae, 0x6b], trackEntry);
	const info = ebml(
		[0x15, 0x49, 0xa9, 0x66],
		ebml([0x2a, 0xd7, 0xb1], encodeUnsigned(1_000_000)),
	);
	const cluster = ebml(
		[0x1f, 0x43, 0xb6, 0x75],
		concatBytes(
			ebml([0xe7], encodeUnsigned(100)),
			ebml([0xa3], buildSimpleBlock(1, 20, packet)),
		),
	);
	const segment = ebml([0x18, 0x53, 0x80, 0x67], concatBytes(info, tracks, cluster));
	return concatBytes(segment);
}

describe("webm opus parser", () => {
	it("extracts track metadata and simple block packets", () => {
		const opusHead = buildOpusHead();
		const packet = new Uint8Array([0xaa, 0xbb, 0xcc]);
		const elements = [
			detail({ name: "TrackEntry", type: "m", isEnd: false }),
			detail({ name: "TrackNumber", type: "u", value: 1, data: Buffer.alloc(0) }),
			detail({ name: "TrackType", type: "u", value: 2, data: Buffer.alloc(0) }),
			detail({ name: "CodecID", type: "s", value: "A_OPUS", data: Buffer.alloc(0) }),
			detail({ name: "CodecPrivate", type: "b", value: Buffer.from(opusHead), data: Buffer.from(opusHead) }),
			detail({ name: "CodecDelay", type: "u", value: 6_500_000, data: Buffer.alloc(0) }),
			detail({ name: "Audio", type: "m", isEnd: false }),
			detail({ name: "Channels", type: "u", value: 2, data: Buffer.alloc(0) }),
			detail({ name: "Audio", type: "m", isEnd: true }),
			detail({ name: "TrackEntry", type: "m", isEnd: true }),
			detail({ name: "TimestampScale", type: "u", value: 1_000_000, data: Buffer.alloc(0) }),
			detail({ name: "Timestamp", type: "u", value: 100, data: Buffer.alloc(0) }),
			detail({ name: "SimpleBlock", type: "b", value: Buffer.from(packet), data: Buffer.from(buildSimpleBlock(1, 20, packet)) }),
		] as WebmElementDetail[];
		const state = createWebmOpusParserState();
		const parsed = processWebmOpusElements(elements, state);
		expect(parsed.head?.channels).toBe(2);
		expect(parsed.head?.preSkip).toBe(312);
		expect(parsed.packets).toHaveLength(1);
		expect(parsed.packets[0]?.packet).toEqual(packet);
		expect(parsed.packets[0]?.timestampUs).toBe(113_500);
	});

	it("parses incremental webm bytes without ts-ebml", () => {
		const packet = new Uint8Array([0xaa, 0xbb, 0xcc]);
		const bytes = buildMinimalWebmStream(packet);
		const state = createWebmOpusParserState();

		const first = appendWebmOpusBytes(bytes.subarray(0, 17), state);
		expect(first.head).toBeNull();
		expect(first.packets).toHaveLength(0);

		const second = appendWebmOpusBytes(bytes.subarray(17), state);
		expect(second.head?.channels).toBe(2);
		expect(second.head?.preSkip).toBe(312);
		expect(second.packets).toHaveLength(1);
		expect(second.packets[0]?.packet).toEqual(packet);
		expect(second.packets[0]?.timestampUs).toBe(113_500);
	});
});
