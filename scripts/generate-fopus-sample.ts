// Generate a .fopus (FROPUS01 framed raw Opus) file from an OGG Opus file.
// Usage: bun run scripts/generate-fopus-sample.ts [input.opus] [output.fopus]

const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53] as const;

function readUint64LE(buf: Uint8Array, offset: number): bigint {
	let value = 0n;
	for (let i = 0; i < 8; i++) {
		value |= BigInt(buf[offset + i] ?? 0) << BigInt(i * 8);
	}
	return value;
}

interface OggPage {
	headerType: number;
	granulePosition: bigint;
	packets: Uint8Array[];
	continued: boolean;
	lastPacketComplete: boolean;
}

function parseOggPages(buf: Uint8Array): OggPage[] {
	const pages: OggPage[] = [];
	let cursor = 0;

	while (cursor < buf.length) {
		// Find OggS sync
		let sync = -1;
		for (let i = cursor; i <= buf.length - 4; i++) {
			if (
				buf[i] === OGG_MAGIC[0] &&
				buf[i + 1] === OGG_MAGIC[1] &&
				buf[i + 2] === OGG_MAGIC[2] &&
				buf[i + 3] === OGG_MAGIC[3]
			) {
				sync = i;
				break;
			}
		}
		if (sync < 0) break;
		cursor = sync;
		if (cursor + 27 > buf.length) break;

		const version = buf[cursor + 4] ?? 255;
		if (version !== 0) {
			cursor += 1;
			continue;
		}

		const headerType = buf[cursor + 5] ?? 0;
		const granulePosition = readUint64LE(buf, cursor + 6);
		const numSegments = buf[cursor + 26] ?? 0;

		if (cursor + 27 + numSegments > buf.length) break;

		const segmentTable = buf.slice(cursor + 27, cursor + 27 + numSegments);
		let dataLength = 0;
		for (let i = 0; i < numSegments; i++) {
			dataLength += segmentTable[i];
		}

		const dataStart = cursor + 27 + numSegments;
		if (dataStart + dataLength > buf.length) break;
		const data = buf.slice(dataStart, dataStart + dataLength);

		// Parse packets from segments
		const packets: Uint8Array[] = [];
		const packetStart = 0;
		for (let i = 0; i < numSegments; i++) {
			const segLen = segmentTable[i];
			if (segLen < 255) {
				// End of packet
				packets.push(
					data.slice(packetStart, packetStart + segLen + (i > 0 ? 0 : 0)),
				);
				// Actually, need to accumulate properly
			}
		}

		// Simpler approach: reassemble packets from segment table
		const reassembledPackets: Uint8Array[] = [];
		let pktChunks: Uint8Array[] = [];
		let pktOffset = 0;
		for (let i = 0; i < numSegments; i++) {
			const segLen = segmentTable[i];
			pktChunks.push(data.slice(pktOffset, pktOffset + segLen));
			pktOffset += segLen;
			if (segLen < 255) {
				// Packet boundary
				const totalLen = pktChunks.reduce((s, c) => s + c.length, 0);
				const packet = new Uint8Array(totalLen);
				let off = 0;
				for (const chunk of pktChunks) {
					packet.set(chunk, off);
					off += chunk.length;
				}
				reassembledPackets.push(packet);
				pktChunks = [];
			}
		}
		// If last segment was 255, there's a continued packet
		const lastPacketComplete =
			numSegments === 0 || segmentTable[numSegments - 1] < 255;
		if (!lastPacketComplete && pktChunks.length > 0) {
			const totalLen = pktChunks.reduce((s, c) => s + c.length, 0);
			const packet = new Uint8Array(totalLen);
			let off = 0;
			for (const chunk of pktChunks) {
				packet.set(chunk, off);
				off += chunk.length;
			}
			reassembledPackets.push(packet);
		}

		pages.push({
			headerType,
			granulePosition,
			packets: reassembledPackets,
			continued: (headerType & 0x01) !== 0,
			lastPacketComplete,
		});

		cursor = dataStart + dataLength;
	}

	return pages;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number): void {
	buf[offset] = value & 0xff;
	buf[offset + 1] = (value >> 8) & 0xff;
	buf[offset + 2] = (value >> 16) & 0xff;
	buf[offset + 3] = (value >> 24) & 0xff;
}

async function main() {
	const inputPath = process.argv[2] ?? "src/sounds/example.opus";
	const outputPath = process.argv[3] ?? "src/sounds/example.fopus";

	const inputData = await Bun.file(inputPath).bytes();
	console.log(`Read ${inputData.length} bytes from ${inputPath}`);

	const pages = parseOggPages(new Uint8Array(inputData));
	console.log(`Parsed ${pages.length} OGG pages`);

	// First page should contain the OpusHead packet
	let opusHead: Uint8Array | null = null;
	const audioPackets: Uint8Array[] = [];

	for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
		const page = pages[pageIdx];
		for (const packet of page.packets) {
			if (packet.length >= 8) {
				const tag = new TextDecoder().decode(packet.slice(0, 8));
				if (tag === "OpusHead") {
					opusHead = packet;
					continue;
				}
				if (tag === "OpusTags") {
					// Skip comment header
					continue;
				}
			}
			// Audio packet
			if (opusHead && packet.length > 0) {
				audioPackets.push(packet);
			}
		}
	}

	if (!opusHead) {
		console.error("No OpusHead found in OGG file");
		process.exit(1);
	}

	console.log(
		`Found OpusHead (${opusHead.length} bytes) and ${audioPackets.length} audio packets`,
	);

	// Build FROPUS01 file
	const magic = new TextEncoder().encode("FROPUS01");
	let totalSize = magic.length + 4 + opusHead.length; // magic + headLen + headData
	for (const pkt of audioPackets) {
		totalSize += 4 + pkt.length; // length prefix + data per packet
	}

	const output = new Uint8Array(totalSize);
	let cursor = 0;

	// Magic
	output.set(magic, cursor);
	cursor += magic.length;

	// OpusHead length + data
	writeUint32LE(output, cursor, opusHead.length);
	cursor += 4;
	output.set(opusHead, cursor);
	cursor += opusHead.length;

	// Audio packets
	for (const pkt of audioPackets) {
		writeUint32LE(output, cursor, pkt.length);
		cursor += 4;
		output.set(pkt, cursor);
		cursor += pkt.length;
	}

	await Bun.write(outputPath, output);
	console.log(`Wrote ${output.length} bytes to ${outputPath}`);
}

main();
