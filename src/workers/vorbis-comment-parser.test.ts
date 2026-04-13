import { describe, expect, test } from "bun:test";
import { parseVorbisComment } from "./vorbis-comment-parser";

function makeVorbisComment(
	comments: string[],
	vendor = "test vendor",
): Uint8Array {
	const encoder = new TextEncoder();
	const vendorBytes = encoder.encode(vendor);

	// Calculate total size
	let size = 4 + vendorBytes.length + 4; // vendor len + vendor + comment count
	const commentBytes: Uint8Array[] = [];
	for (const comment of comments) {
		const bytes = encoder.encode(comment);
		commentBytes.push(bytes);
		size += 4 + bytes.length;
	}

	const buf = new Uint8Array(size);
	const view = new DataView(buf.buffer);
	let offset = 0;

	// Vendor string
	view.setUint32(offset, vendorBytes.length, true);
	offset += 4;
	buf.set(vendorBytes, offset);
	offset += vendorBytes.length;

	// Comment count
	view.setUint32(offset, commentBytes.length, true);
	offset += 4;

	// Comments
	for (const bytes of commentBytes) {
		view.setUint32(offset, bytes.length, true);
		offset += 4;
		buf.set(bytes, offset);
		offset += bytes.length;
	}

	return buf;
}

describe("parseVorbisComment", () => {
	test("returns null for too-small buffer", () => {
		expect(parseVorbisComment(new Uint8Array(4))).toBeNull();
	});

	test("parses title and artist", () => {
		const data = makeVorbisComment(["TITLE=Test Song", "ARTIST=Test Artist"]);
		const metadata = parseVorbisComment(data);
		expect(metadata).not.toBeNull();
		expect(metadata?.title).toBe("Test Song");
		expect(metadata?.artist).toBe("Test Artist");
	});

	test("parses all common fields", () => {
		const data = makeVorbisComment([
			"TITLE=My Song",
			"ARTIST=My Artist",
			"ALBUM=My Album",
			"TRACKNUMBER=7",
			"DATE=2023",
			"GENRE=Electronic",
		]);
		const metadata = parseVorbisComment(data);
		expect(metadata).not.toBeNull();
		expect(metadata?.title).toBe("My Song");
		expect(metadata?.artist).toBe("My Artist");
		expect(metadata?.album).toBe("My Album");
		expect(metadata?.trackNumber).toBe(7);
		expect(metadata?.year).toBe(2023);
		expect(metadata?.genre).toBe("Electronic");
	});

	test("is case-insensitive for keys", () => {
		const data = makeVorbisComment(["title=lowercase title"]);
		const metadata = parseVorbisComment(data);
		expect(metadata?.title).toBe("lowercase title");
	});

	test("returns null for empty comments", () => {
		const data = makeVorbisComment([]);
		expect(parseVorbisComment(data)).toBeNull();
	});

	test("handles UTF-8 in values", () => {
		const data = makeVorbisComment(["TITLE=Ünïcödé Sôñg"]);
		const metadata = parseVorbisComment(data);
		expect(metadata?.title).toBe("Ünïcödé Sôñg");
	});
});
