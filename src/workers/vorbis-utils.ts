// Vorbis header parsing and Xiph extradata construction utilities.
// Used by both OGG Vorbis and WebM Vorbis decode workers.

const VORBIS_MAGIC = [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]; // "\x01vorbis"

export interface VorbisIdentification {
	channels: number;
	sampleRate: number;
	bitrateNominal: number;
}

/** Check if the first OGG packet indicates a Vorbis stream. */
export function isVorbisStream(firstPacket: Uint8Array): boolean {
	if (firstPacket.length < 7) return false;
	for (let i = 0; i < 7; i++) {
		if (firstPacket[i] !== VORBIS_MAGIC[i]) return false;
	}
	return true;
}

/** Parse the Vorbis identification header (packet 0, 30 bytes minimum). */
export function parseVorbisIdentification(
	packet: Uint8Array,
): VorbisIdentification | null {
	if (packet.length < 30) return null;
	// Validate "\x01vorbis" magic
	for (let i = 0; i < 7; i++) {
		if (packet[i] !== VORBIS_MAGIC[i]) return null;
	}
	// vorbis_version (bytes 7-10, u32LE) must be 0
	const version =
		packet[7] | (packet[8] << 8) | (packet[9] << 16) | (packet[10] << 24);
	if (version !== 0) return null;

	const channels = packet[11];
	if (channels === 0) return null;

	const sampleRate =
		packet[12] | (packet[13] << 8) | (packet[14] << 16) | (packet[15] << 24);
	if (sampleRate <= 0) return null;

	const bitrateNominal =
		packet[20] | (packet[21] << 8) | (packet[22] << 16) | (packet[23] << 24);

	// Framing flag (byte 29) must be 1
	if ((packet[29] & 0x01) !== 1) return null;

	return { channels, sampleRate, bitrateNominal };
}

/**
 * Build Xiph extradata from the 3 Vorbis header packets.
 * Format (per W3C WebCodecs Vorbis Registration):
 *   [1 byte]   number of packets minus one (always 2)
 *   [N bytes]  Xiph-laced size of id header
 *   [N bytes]  Xiph-laced size of comment header
 *   (setup header size is implicit: remainder)
 *   [...] id header bytes
 *   [...] comment header bytes
 *   [...] setup header bytes
 */
export function buildXiphExtradata(
	idHeader: Uint8Array,
	commentHeader: Uint8Array,
	setupHeader: Uint8Array,
): Uint8Array {
	const idSize = idHeader.length;
	const commentSize = commentHeader.length;

	// Xiph lacing: each size is encoded as N×255 + remainder
	const lacedIdSize = xiphLace(idSize);
	const lacedCommentSize = xiphLace(commentSize);

	const totalSize =
		1 +
		lacedIdSize.length +
		lacedCommentSize.length +
		idSize +
		commentSize +
		setupHeader.length;
	const out = new Uint8Array(totalSize);
	let offset = 0;

	// Number of packets minus one
	out[offset++] = 0x02;

	// Xiph-laced sizes
	out.set(lacedIdSize, offset);
	offset += lacedIdSize.length;
	out.set(lacedCommentSize, offset);
	offset += lacedCommentSize.length;

	// Packet data
	out.set(idHeader, offset);
	offset += idSize;
	out.set(commentHeader, offset);
	offset += commentSize;
	out.set(setupHeader, offset);

	return out;
}

function xiphLace(size: number): Uint8Array {
	const full = Math.floor(size / 255);
	const remainder = size % 255;
	const result = new Uint8Array(full + 1);
	for (let i = 0; i < full; i++) {
		result[i] = 255;
	}
	result[full] = remainder;
	return result;
}
