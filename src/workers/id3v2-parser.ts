// Minimal ID3v2 tag parser for extracting text metadata from MP3 files.
// Supports ID3v2.3 and ID3v2.4 text frames.

import type { AudioMetadata } from "../audio/types";

/** Parse an ID3v2 tag from the beginning of a buffer.
 *  Returns extracted metadata, or null if no ID3v2 tag found. */
export function parseId3v2(buf: Uint8Array): AudioMetadata | null {
	if (buf.length < 10) return null;
	// Magic: "ID3"
	if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;

	const majorVersion = buf[3];
	if (majorVersion < 2 || majorVersion > 4) return null;

	const tagSize =
		((buf[6] & 0x7f) << 21) |
		((buf[7] & 0x7f) << 14) |
		((buf[8] & 0x7f) << 7) |
		(buf[9] & 0x7f);

	if (buf.length < 10 + tagSize) return null;

	const metadata: AudioMetadata = {};
	const isV22 = majorVersion === 2;
	const headerSize = isV22 ? 6 : 10;
	let offset = 10;
	const end = 10 + tagSize;

	while (offset + headerSize <= end) {
		let frameId: string;
		let frameSize: number;

		if (isV22) {
			frameId = String.fromCharCode(
				buf[offset],
				buf[offset + 1],
				buf[offset + 2],
			);
			frameSize =
				(buf[offset + 3] << 16) | (buf[offset + 4] << 8) | buf[offset + 5];
		} else {
			frameId = String.fromCharCode(
				buf[offset],
				buf[offset + 1],
				buf[offset + 2],
				buf[offset + 3],
			);
			if (majorVersion === 4) {
				// ID3v2.4 uses syncsafe integers for frame size
				frameSize =
					((buf[offset + 4] & 0x7f) << 21) |
					((buf[offset + 5] & 0x7f) << 14) |
					((buf[offset + 6] & 0x7f) << 7) |
					(buf[offset + 7] & 0x7f);
			} else {
				frameSize =
					(buf[offset + 4] << 24) |
					(buf[offset + 5] << 16) |
					(buf[offset + 6] << 8) |
					buf[offset + 7];
			}
		}

		if (frameSize === 0 || frameId[0] === "\0") break;
		offset += headerSize;

		if (offset + frameSize > end) break;

		const frameData = buf.subarray(offset, offset + frameSize);

		// Map V2.2 frame IDs to V2.3+ equivalents
		const normalizedId = isV22 ? mapV22ToV23(frameId) : frameId;

		switch (normalizedId) {
			case "TIT2": {
				const title = decodeTextFrame(frameData);
				if (title !== undefined) metadata.title = title;
				break;
			}
			case "TPE1": {
				const artist = decodeTextFrame(frameData);
				if (artist !== undefined) metadata.artist = artist;
				break;
			}
			case "TALB": {
				const album = decodeTextFrame(frameData);
				if (album !== undefined) metadata.album = album;
				break;
			}
			case "TRCK": {
				const track = decodeTextFrame(frameData);
				if (track) {
					const num = Number.parseInt(track.split("/")[0], 10);
					if (!Number.isNaN(num)) metadata.trackNumber = num;
				}
				break;
			}
			case "TYER":
			case "TDRC": {
				const year = decodeTextFrame(frameData);
				if (year) {
					const num = Number.parseInt(year, 10);
					if (!Number.isNaN(num)) metadata.year = num;
				}
				break;
			}
			case "TCON": {
				const genre = decodeTextFrame(frameData);
				if (genre !== undefined) metadata.genre = genre;
				break;
			}
			case "APIC": {
				const pic = parseApicFrame(frameData);
				if (pic) metadata.picture = pic;
				break;
			}
		}

		offset += frameSize;
	}

	return Object.keys(metadata).length > 0 ? metadata : null;
}

function mapV22ToV23(id: string): string {
	const map: Record<string, string> = {
		TT2: "TIT2",
		TP1: "TPE1",
		TAL: "TALB",
		TRK: "TRCK",
		TYE: "TYER",
		TCO: "TCON",
		PIC: "APIC",
	};
	return map[id] ?? id;
}

function decodeTextFrame(data: Uint8Array): string | undefined {
	if (data.length < 2) return undefined;
	const encoding = data[0];
	const textBytes = data.subarray(1);

	switch (encoding) {
		case 0: // ISO-8859-1
			return decodeLatin1(textBytes);
		case 1: // UTF-16 with BOM
			return decodeUtf16WithBom(textBytes);
		case 2: // UTF-16BE
			return decodeUtf16Be(textBytes);
		case 3: // UTF-8
			return decodeUtf8(textBytes);
		default:
			return decodeLatin1(textBytes);
	}
}

function decodeLatin1(bytes: Uint8Array): string {
	let str = "";
	for (const byte of bytes) {
		if (byte === 0) break;
		str += String.fromCharCode(byte);
	}
	return str;
}

function decodeUtf8(bytes: Uint8Array): string {
	// Find null terminator
	let end = bytes.length;
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0) {
			end = i;
			break;
		}
	}
	return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}

function decodeUtf16WithBom(bytes: Uint8Array): string {
	if (bytes.length < 2) return "";
	const bom = (bytes[0] << 8) | bytes[1];
	const isLE = bom === 0xfffe;
	const start = 2;
	return decodeUtf16(bytes.subarray(start), isLE);
}

function decodeUtf16Be(bytes: Uint8Array): string {
	return decodeUtf16(bytes, false);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
	let str = "";
	for (let i = 0; i + 1 < bytes.length; i += 2) {
		const code = littleEndian
			? bytes[i] | (bytes[i + 1] << 8)
			: (bytes[i] << 8) | bytes[i + 1];
		if (code === 0) break;
		str += String.fromCharCode(code);
	}
	return str;
}

function parseApicFrame(
	data: Uint8Array,
): { data: ArrayBuffer; mimeType: string } | null {
	if (data.length < 4) return null;
	const encoding = data[0];
	let offset = 1;

	// Read MIME type (null-terminated Latin-1)
	let mimeType = "";
	while (offset < data.length && data[offset] !== 0) {
		mimeType += String.fromCharCode(data[offset]);
		offset++;
	}
	offset++; // skip null

	if (offset >= data.length) return null;
	// Skip picture type byte
	offset++;

	// Skip description (encoding-dependent null terminator)
	if (encoding === 1 || encoding === 2) {
		// UTF-16: look for double null
		while (offset + 1 < data.length) {
			if (data[offset] === 0 && data[offset + 1] === 0) {
				offset += 2;
				break;
			}
			offset += 2;
		}
	} else {
		// Latin-1 or UTF-8: single null
		while (offset < data.length && data[offset] !== 0) offset++;
		offset++;
	}

	if (offset >= data.length) return null;

	return {
		data: data.slice(offset).buffer as ArrayBuffer,
		mimeType: mimeType || "image/jpeg",
	};
}
