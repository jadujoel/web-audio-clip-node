import { err, ok, type Result } from "neverthrow";
import {
	createFallbackOpusHead,
	type OpusHead,
	parseOpusHead,
} from "./opus-worker-common";

export interface ParsedWebmOpusPacket {
	packet: Uint8Array<ArrayBufferLike>;
	timestampUs: number;
}

type ElementType = "m" | "u" | "s" | "8" | "b";

export interface WebmElementDetail {
	name: string;
	type: ElementType;
	isEnd?: boolean;
	value?: number | string;
	data: Uint8Array<ArrayBufferLike>;
}

interface PartialTrackInfo {
	trackNumber?: number;
	trackType?: number;
	codecId?: string;
	codecPrivate?: Uint8Array<ArrayBufferLike> | null;
	channels?: number;
	codecDelayNs?: number;
}

interface WebmOpusTrackInfo {
	trackNumber: number;
	channels: number;
	codecPrivate: Uint8Array<ArrayBufferLike> | null;
	codecDelayNs: number;
}

interface ParserStackEntry {
	name: string;
	end: number | null;
}

export interface WebmOpusParserState {
	timestampScaleNs: number;
	clusterTimestamp: number;
	currentTrack: PartialTrackInfo | null;
	activeTrack: WebmOpusTrackInfo | null;
	inAudio: boolean;
	buffer: Uint8Array<ArrayBufferLike>;
	byteOffset: number;
	elementStack: ParserStackEntry[];
}

export interface WebmOpusParseResult {
	packets: ParsedWebmOpusPacket[];
	head: OpusHead | null;
}

const EMPTY_BYTES = new Uint8Array(0);
const UTF8_DECODER = new TextDecoder();
const ASCII_DECODER = new TextDecoder("ascii");

const WEBM_ELEMENTS = new Map<number, { name: string; type: ElementType }>([
	[0x1a45dfa3, { name: "EBML", type: "m" }],
	[0x18538067, { name: "Segment", type: "m" }],
	[0x114d9b74, { name: "SeekHead", type: "m" }],
	[0x1549a966, { name: "Info", type: "m" }],
	[0x1654ae6b, { name: "Tracks", type: "m" }],
	[0x1f43b675, { name: "Cluster", type: "m" }],
	[0x1c53bb6b, { name: "Cues", type: "m" }],
	[0xae, { name: "TrackEntry", type: "m" }],
	[0xe1, { name: "Audio", type: "m" }],
	[0x2ad7b1, { name: "TimestampScale", type: "u" }],
	[0xe7, { name: "Timestamp", type: "u" }],
	[0xd7, { name: "TrackNumber", type: "u" }],
	[0x83, { name: "TrackType", type: "u" }],
	[0x86, { name: "CodecID", type: "s" }],
	[0x63a2, { name: "CodecPrivate", type: "b" }],
	[0x56aa, { name: "CodecDelay", type: "u" }],
	[0x9f, { name: "Channels", type: "u" }],
	[0xa3, { name: "SimpleBlock", type: "b" }],
	[0xa1, { name: "Block", type: "b" }],
]);

interface VintResult {
	length: number;
	value: number;
}

interface ParsedBlock {
	trackNumber: number;
	timecode: number;
	frames: Uint8Array<ArrayBufferLike>[];
}

export function createWebmOpusParserState(): WebmOpusParserState {
	return {
		timestampScaleNs: 1_000_000,
		clusterTimestamp: 0,
		currentTrack: null,
		activeTrack: null,
		inAudio: false,
		buffer: EMPTY_BYTES,
		byteOffset: 0,
		elementStack: [],
	};
}

function concatBytes(
	left: Uint8Array<ArrayBufferLike>,
	right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
	if (left.length === 0) return right;
	if (right.length === 0) return left;
	const combined = new Uint8Array(left.length + right.length);
	combined.set(left, 0);
	combined.set(right, left.length);
	return combined;
}

function toUint8Array(bytes: Uint8Array): Uint8Array<ArrayBufferLike> {
	return new Uint8Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	);
}

function readEbmlId(bytes: Uint8Array, offset: number): VintResult | null {
	if (offset >= bytes.length) return null;
	const firstByte = bytes[offset];
	if (firstByte === 0) return null;
	let length = 1;
	while (length <= 4 && (firstByte & (1 << (8 - length))) === 0) {
		length += 1;
	}
	if (length > 4 || offset + length > bytes.length) return null;
	let value = 0;
	for (let index = 0; index < length; index++) {
		value = (value << 8) | (bytes[offset + index] ?? 0);
	}
	return { length, value };
}

function readVint(
	bytes: Uint8Array,
	offset: number,
	signed = false,
): VintResult | null {
	if (offset >= bytes.length) return null;
	const firstByte = bytes[offset];
	if (firstByte === 0) return null;
	let length = 1;
	while (length <= 8 && (firstByte & (1 << (8 - length))) === 0) {
		length += 1;
	}
	if (length > 8 || offset + length > bytes.length) return null;

	let value = firstByte & ((1 << (8 - length)) - 1);
	for (let index = 1; index < length; index++) {
		value = value * 256 + (bytes[offset + index] ?? 0);
	}

	const maxValue = 2 ** (7 * length) - 1;
	if (!signed && value === maxValue) {
		return { length, value: -1 };
	}
	if (signed) {
		value -= 2 ** (7 * length - 1) - 1;
	}
	return { length, value };
}

function readUnsigned(bytes: Uint8Array): number {
	let value = 0;
	for (const byte of bytes) {
		value = value * 256 + byte;
	}
	return value;
}

function decodeElementValue(
	info: { name: string; type: ElementType },
	data: Uint8Array<ArrayBufferLike>,
): WebmElementDetail {
	if (info.type === "u") {
		return {
			name: info.name,
			type: info.type,
			value: readUnsigned(data),
			data,
		};
	}
	if (info.type === "s") {
		return {
			name: info.name,
			type: info.type,
			value: ASCII_DECODER.decode(data),
			data,
		};
	}
	if (info.type === "8") {
		return {
			name: info.name,
			type: info.type,
			value: UTF8_DECODER.decode(data),
			data,
		};
	}
	return { name: info.name, type: info.type, data };
}

function drainCompletedMasters(
	state: WebmOpusParserState,
	absoluteOffset: number,
	elements: WebmElementDetail[],
) {
	while (state.elementStack.length > 0) {
		const top = state.elementStack[state.elementStack.length - 1];
		if (!top) break;
		if (top.end == null || absoluteOffset < top.end) {
			break;
		}
		state.elementStack.pop();
		elements.push({
			name: top.name,
			type: "m",
			isEnd: true,
			data: EMPTY_BYTES,
		});
	}
}

function parseBlockFrames(
	payload: Uint8Array,
	lacing: number,
): Uint8Array<ArrayBufferLike>[] {
	if (lacing === 0) {
		return [toUint8Array(payload)];
	}
	if (payload.length === 0) {
		return [];
	}

	let cursor = 0;
	const frameCount = (payload[cursor++] ?? 0) + 1;
	const sizes: number[] = [];

	if (lacing === 2) {
		const size = Math.floor((payload.length - cursor) / frameCount);
		for (let index = 0; index < frameCount; index++) sizes.push(size);
		return sizes.map((frameSize, index) => {
			const start = cursor + index * frameSize;
			return toUint8Array(payload.subarray(start, start + frameSize));
		});
	}

	if (lacing === 1) {
		let total = 0;
		for (let index = 0; index < frameCount - 1; index++) {
			let size = 0;
			while (cursor < payload.length) {
				const value = payload[cursor++] ?? 0;
				size += value;
				if (value !== 0xff) break;
			}
			sizes.push(size);
			total += size;
		}
		sizes.push(payload.length - cursor - total);
	} else {
		const firstSize = readVint(payload, cursor, false);
		if (!firstSize) return [];
		cursor += firstSize.length;
		sizes.push(firstSize.value);
		let total = firstSize.value;
		for (let index = 1; index < frameCount - 1; index++) {
			const delta = readVint(payload, cursor, true);
			if (!delta) return [];
			cursor += delta.length;
			const nextSize = (sizes[index - 1] ?? 0) + delta.value;
			sizes.push(nextSize);
			total += nextSize;
		}
		sizes.push(payload.length - cursor - total);
	}

	const frames: Uint8Array<ArrayBufferLike>[] = [];
	for (const size of sizes) {
		frames.push(toUint8Array(payload.subarray(cursor, cursor + size)));
		cursor += size;
	}
	return frames;
}

function parseBlock(data: Uint8Array): Result<ParsedBlock, Error> {
	const track = readVint(data, 0, false);
	if (!track) {
		return err(new Error("Invalid WebM block: missing track number"));
	}
	let cursor = track.length;
	if (data.length < cursor + 3) {
		return err(new Error("Invalid WebM block: truncated header"));
	}
	let timecode = ((data[cursor] ?? 0) << 8) | (data[cursor + 1] ?? 0);
	if (timecode & 0x8000) {
		timecode -= 0x10000;
	}
	cursor += 2;
	const flags = data[cursor++] ?? 0;
	const lacing = (flags >> 1) & 0x03;
	const frames = parseBlockFrames(data.subarray(cursor), lacing);
	return ok({
		trackNumber: track.value,
		timecode,
		frames,
	});
}

function parseWebmElements(
	chunk: Uint8Array<ArrayBufferLike>,
	state: WebmOpusParserState,
): WebmElementDetail[] {
	state.buffer = concatBytes(state.buffer, chunk);
	const elements: WebmElementDetail[] = [];
	let cursor = 0;

	while (true) {
		drainCompletedMasters(state, state.byteOffset + cursor, elements);

		const id = readEbmlId(state.buffer, cursor);
		if (!id) break;
		const size = readVint(state.buffer, cursor + id.length, false);
		if (!size) break;
		const headerSize = id.length + size.length;
		if (state.buffer.length < cursor + headerSize) break;

		const info = WEBM_ELEMENTS.get(id.value) ?? {
			name: "unknown",
			type: "b" as const,
		};
		const dataSize = size.value;
		const absoluteContentStart = state.byteOffset + cursor + headerSize;
		cursor += headerSize;

		if (info.type === "m") {
			elements.push({
				name: info.name,
				type: "m",
				isEnd: false,
				data: EMPTY_BYTES,
			});
			state.elementStack.push({
				name: info.name,
				end: dataSize >= 0 ? absoluteContentStart + dataSize : null,
			});
			continue;
		}

		if (dataSize < 0 || state.buffer.length < cursor + dataSize) {
			cursor -= headerSize;
			break;
		}

		const data = toUint8Array(state.buffer.subarray(cursor, cursor + dataSize));
		elements.push(decodeElementValue(info, data));
		cursor += dataSize;
	}

	state.byteOffset += cursor;
	state.buffer = toUint8Array(state.buffer.subarray(cursor));
	drainCompletedMasters(state, state.byteOffset, elements);
	return elements;
}

export function processWebmOpusElements(
	elements: WebmElementDetail[],
	state: WebmOpusParserState,
): WebmOpusParseResult {
	const packets: ParsedWebmOpusPacket[] = [];
	let head: OpusHead | null = null;

	for (const element of elements) {
		if (element.type === "m") {
			if (!element.isEnd) {
				if (element.name === "TrackEntry") {
					state.currentTrack = {};
				} else if (element.name === "Audio") {
					state.inAudio = true;
				}
			} else {
				if (element.name === "TrackEntry") {
					if (
						state.activeTrack == null &&
						state.currentTrack?.trackType === 2 &&
						state.currentTrack.codecId === "A_OPUS" &&
						state.currentTrack.trackNumber != null
					) {
						const channels = state.currentTrack.channels ?? 2;
						const codecPrivate = state.currentTrack.codecPrivate ?? null;
						state.activeTrack = {
							trackNumber: state.currentTrack.trackNumber,
							channels,
							codecPrivate,
							codecDelayNs: state.currentTrack.codecDelayNs ?? 0,
						};
						head =
							codecPrivate != null
								? (parseOpusHead(codecPrivate) ??
									createFallbackOpusHead(channels))
								: createFallbackOpusHead(channels);
					}
					state.currentTrack = null;
				} else if (element.name === "Audio") {
					state.inAudio = false;
				}
			}
			continue;
		}

		if (element.name === "TimestampScale" || element.name === "TimecodeScale") {
			state.timestampScaleNs = element.value as number;
			continue;
		}
		if (element.name === "Timestamp" || element.name === "Timecode") {
			state.clusterTimestamp = element.value as number;
			continue;
		}

		if (state.currentTrack != null) {
			switch (element.name) {
				case "TrackNumber":
					state.currentTrack.trackNumber = element.value as number;
					continue;
				case "TrackType":
					state.currentTrack.trackType = element.value as number;
					continue;
				case "CodecID":
					state.currentTrack.codecId = element.value as string;
					continue;
				case "CodecPrivate":
					state.currentTrack.codecPrivate = element.data;
					continue;
				case "CodecDelay":
					state.currentTrack.codecDelayNs = element.value as number;
					continue;
				case "Channels":
					if (state.inAudio) {
						state.currentTrack.channels = element.value as number;
					}
					continue;
			}
		}

		if (
			state.activeTrack != null &&
			(element.name === "SimpleBlock" || element.name === "Block")
		) {
			const blockResult = parseBlock(element.data);
			if (blockResult.isErr()) continue;
			const block = blockResult.value;
			if (block.trackNumber !== state.activeTrack.trackNumber) {
				continue;
			}
			const baseTimestampUs = Math.max(
				0,
				Math.round(
					((state.clusterTimestamp + block.timecode) * state.timestampScaleNs -
						state.activeTrack.codecDelayNs) /
						1_000,
				),
			);
			for (let index = 0; index < block.frames.length; index++) {
				packets.push({
					packet: block.frames[index] ?? new Uint8Array(0),
					timestampUs: baseTimestampUs + index,
				});
			}
		}
	}

	return { packets, head };
}

export function appendWebmOpusBytes(
	chunk: Uint8Array<ArrayBufferLike>,
	state: WebmOpusParserState,
): WebmOpusParseResult {
	return processWebmOpusElements(parseWebmElements(chunk, state), state);
}
