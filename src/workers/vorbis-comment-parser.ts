// Minimal Vorbis Comment parser for extracting metadata from Ogg/FLAC streams.
// Used by Ogg Opus, Ogg Vorbis, Ogg FLAC, and native FLAC workers.

import type { AudioMetadata } from "../audio/clip/types";

/** Parse a Vorbis Comment block (without the framing bit).
 *  `data` should start at the vendor string length field. */
export function parseVorbisComment(data: Uint8Array): AudioMetadata | null {
	if (data.length < 8) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let offset = 0;

	// Vendor string length (little-endian 32-bit)
	const vendorLen = view.getUint32(offset, true);
	offset += 4;
	if (offset + vendorLen > data.length) return null;
	offset += vendorLen;

	// Number of comments
	if (offset + 4 > data.length) return null;
	const commentCount = view.getUint32(offset, true);
	offset += 4;

	const metadata: AudioMetadata = {};
	const decoder = new TextDecoder("utf-8");

	for (let i = 0; i < commentCount; i++) {
		if (offset + 4 > data.length) break;
		const commentLen = view.getUint32(offset, true);
		offset += 4;
		if (offset + commentLen > data.length) break;

		const comment = decoder.decode(data.subarray(offset, offset + commentLen));
		offset += commentLen;

		const eqIdx = comment.indexOf("=");
		if (eqIdx < 0) continue;

		const key = comment.substring(0, eqIdx).toUpperCase();
		const value = comment.substring(eqIdx + 1);

		switch (key) {
			case "TITLE":
				metadata.title = value;
				break;
			case "ARTIST":
				metadata.artist = value;
				break;
			case "ALBUM":
				metadata.album = value;
				break;
			case "TRACKNUMBER": {
				const num = Number.parseInt(value, 10);
				if (!Number.isNaN(num)) metadata.trackNumber = num;
				break;
			}
			case "DATE": {
				const year = Number.parseInt(value, 10);
				if (!Number.isNaN(year)) metadata.year = year;
				break;
			}
			case "GENRE":
				metadata.genre = value;
				break;
		}
	}

	return Object.keys(metadata).length > 0 ? metadata : null;
}
