import {
	parseOpusHead,
	type OpusHead,
} from "./opus-worker-common";

export const FRAMED_RAW_OPUS_MAGIC = "FROPUS01";

const magicBytes = new TextEncoder().encode(FRAMED_RAW_OPUS_MAGIC);

export interface FramedRawOpusStreamState {
	headerParsed: boolean;
	head: OpusHead | null;
}

export interface FramedRawOpusParseResult {
	packets: Uint8Array<ArrayBufferLike>[];
	leftover: Uint8Array<ArrayBufferLike>;
	head: OpusHead | null;
}

export function createFramedRawOpusStreamState(): FramedRawOpusStreamState {
	return {
		headerParsed: false,
		head: null,
	};
}

function readUint32LE(buf: Uint8Array, offset: number): number {
	return (
		(buf[offset] ?? 0) |
		((buf[offset + 1] ?? 0) << 8) |
		((buf[offset + 2] ?? 0) << 16) |
		((buf[offset + 3] ?? 0) << 24)
	) >>> 0;
}

export function parseFramedRawOpusStream(
	buf: Uint8Array<ArrayBufferLike>,
	state: FramedRawOpusStreamState,
): FramedRawOpusParseResult {
	let cursor = 0;
	if (!state.headerParsed) {
		const headerLength = magicBytes.length + 4;
		if (buf.length < headerLength) {
			return {
				packets: [],
				leftover: buf,
				head: state.head,
			};
		}
		for (let i = 0; i < magicBytes.length; i++) {
			if (buf[i] !== magicBytes[i]) {
				throw new Error(
					`Expected ${FRAMED_RAW_OPUS_MAGIC} header for framed raw Opus transport`,
				);
			}
		}
		const opusHeadLength = readUint32LE(buf, magicBytes.length);
		const opusHeadStart = headerLength;
		const opusHeadEnd = opusHeadStart + opusHeadLength;
		if (buf.length < opusHeadEnd) {
			return {
				packets: [],
				leftover: buf,
				head: state.head,
			};
		}
		const headPacket = buf.slice(opusHeadStart, opusHeadEnd);
		const head = parseOpusHead(headPacket);
		if (!head) {
			throw new Error("Framed raw Opus stream is missing a valid OpusHead packet");
		}
		state.headerParsed = true;
		state.head = head;
		cursor = opusHeadEnd;
	}

	const packets: Uint8Array<ArrayBufferLike>[] = [];
	while (cursor + 4 <= buf.length) {
		const packetLength = readUint32LE(buf, cursor);
		const packetStart = cursor + 4;
		const packetEnd = packetStart + packetLength;
		if (buf.length < packetEnd) {
			break;
		}
		packets.push(buf.slice(packetStart, packetEnd));
		cursor = packetEnd;
	}

	return {
		packets,
		leftover: buf.slice(cursor),
		head: state.head,
	};
}
