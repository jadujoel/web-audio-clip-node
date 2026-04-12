// MP4 (ISO BMFF) parser for AAC audio extraction.
// Parses moov → trak(soun) → stbl sample tables to produce a sample map,
// and extracts AudioSpecificConfig from esds for WebCodecs.

export interface Mp4AudioTrack {
	codecString: string; // e.g. "mp4a.40.2"
	audioSpecificConfig: Uint8Array; // raw bytes for AudioDecoderConfig.description
	sampleRate: number;
	channelCount: number;
	samplesPerFrame: number; // 1024 for AAC-LC, 2048 for HE-AAC
}

export interface Mp4Sample {
	byteOffset: number;
	size: number;
	timestampUs: number;
}

export interface Mp4ParseResult {
	track: Mp4AudioTrack;
	samples: Mp4Sample[];
	mdatOffset: number; // byte offset of mdat payload start
	mdatSize: number; // size of mdat payload
}

// ── Box header parsing ───────────────────────────────────────────────

interface BoxHeader {
	type: string;
	size: number; // total box size including header
	headerSize: number; // 8 or 16
}

function readBoxHeader(buf: Uint8Array, offset: number): BoxHeader | null {
	if (offset + 8 > buf.length) return null;

	const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
	let size = view.getUint32(offset);
	const type = String.fromCharCode(
		buf[offset + 4],
		buf[offset + 5],
		buf[offset + 6],
		buf[offset + 7],
	);

	let headerSize = 8;

	if (size === 1) {
		// Extended 64-bit size
		if (offset + 16 > buf.length) return null;
		const hi = view.getUint32(offset + 8);
		const lo = view.getUint32(offset + 12);
		size = hi * 0x100000000 + lo;
		headerSize = 16;
	} else if (size === 0) {
		// Box extends to end of file
		size = buf.length - offset;
	}

	return { type, size, headerSize };
}

// ── esds / AudioSpecificConfig parsing ───────────────────────────────

function parseDescriptorLength(
	buf: Uint8Array,
	offset: number,
): { length: number; bytesRead: number } {
	let length = 0;
	let bytesRead = 0;
	for (let i = 0; i < 4; i++) {
		if (offset + i >= buf.length) break;
		const b = buf[offset + i];
		bytesRead++;
		length = (length << 7) | (b & 0x7f);
		if ((b & 0x80) === 0) break;
	}
	return { length, bytesRead };
}

interface EsdsResult {
	audioSpecificConfig: Uint8Array;
	audioObjectType: number;
}

function parseEsds(data: Uint8Array): EsdsResult | null {
	// esds is a FullBox: 4 bytes version+flags, then descriptors
	if (data.length < 4) return null;
	let offset = 4; // skip version + flags

	// ES_Descriptor (tag 0x03)
	if (offset >= data.length || data[offset] !== 0x03) return null;
	offset++;
	const esLen = parseDescriptorLength(data, offset);
	offset += esLen.bytesRead;
	// Skip ES_ID (2) + stream priority (1)
	offset += 3;

	// DecoderConfigDescriptor (tag 0x04)
	if (offset >= data.length || data[offset] !== 0x04) return null;
	offset++;
	const dcLen = parseDescriptorLength(data, offset);
	offset += dcLen.bytesRead;
	// Skip objectTypeIndication (1) + streamType etc (1) + bufferSizeDB (3) + maxBitrate (4) + avgBitrate (4) = 13 bytes
	offset += 13;

	// DecoderSpecificInfo (tag 0x05)
	if (offset >= data.length || data[offset] !== 0x05) return null;
	offset++;
	const dsiLen = parseDescriptorLength(data, offset);
	offset += dsiLen.bytesRead;

	if (offset + dsiLen.length > data.length) return null;

	const audioSpecificConfig = data.slice(offset, offset + dsiLen.length);

	// Parse audioObjectType from AudioSpecificConfig
	if (audioSpecificConfig.length < 2) return null;
	let aot = (audioSpecificConfig[0] >> 3) & 0x1f;
	if (aot === 31) {
		// extended audioObjectType
		aot =
			32 +
			(((audioSpecificConfig[0] & 0x07) << 3) |
				((audioSpecificConfig[1] >> 5) & 0x07));
	}

	return { audioSpecificConfig, audioObjectType: aot };
}

function codecStringFromAOT(aot: number): string {
	if (aot === 2) return "mp4a.40.2"; // AAC-LC
	if (aot === 5) return "mp4a.40.5"; // HE-AAC v1
	if (aot === 29) return "mp4a.40.29"; // HE-AAC v2
	return `mp4a.40.${aot}`;
}

// ── Sample table parsers ─────────────────────────────────────────────

function parseStsz(data: Uint8Array): number[] {
	const view = new DataView(data.buffer, data.byteOffset, data.length);
	// FullBox: version(1) + flags(3) = 4
	const sampleSize = view.getUint32(4);
	const sampleCount = view.getUint32(8);
	const sizes: number[] = [];

	if (sampleSize !== 0) {
		// Constant size
		for (let i = 0; i < sampleCount; i++) {
			sizes.push(sampleSize);
		}
	} else {
		for (let i = 0; i < sampleCount; i++) {
			sizes.push(view.getUint32(12 + i * 4));
		}
	}
	return sizes;
}

function parseStco(data: Uint8Array): number[] {
	const view = new DataView(data.buffer, data.byteOffset, data.length);
	const entryCount = view.getUint32(4);
	const offsets: number[] = [];
	for (let i = 0; i < entryCount; i++) {
		offsets.push(view.getUint32(8 + i * 4));
	}
	return offsets;
}

function parseCo64(data: Uint8Array): number[] {
	const view = new DataView(data.buffer, data.byteOffset, data.length);
	const entryCount = view.getUint32(4);
	const offsets: number[] = [];
	for (let i = 0; i < entryCount; i++) {
		const hi = view.getUint32(8 + i * 8);
		const lo = view.getUint32(12 + i * 8);
		offsets.push(hi * 0x100000000 + lo);
	}
	return offsets;
}

interface StscEntry {
	firstChunk: number;
	samplesPerChunk: number;
}

function parseStsc(data: Uint8Array): StscEntry[] {
	const view = new DataView(data.buffer, data.byteOffset, data.length);
	const entryCount = view.getUint32(4);
	const entries: StscEntry[] = [];
	for (let i = 0; i < entryCount; i++) {
		entries.push({
			firstChunk: view.getUint32(8 + i * 12),
			samplesPerChunk: view.getUint32(12 + i * 12),
			// sample_description_index skipped (8 + i*12 + 8)
		});
	}
	return entries;
}

interface SttsEntry {
	sampleCount: number;
	sampleDelta: number;
}

function parseStts(data: Uint8Array): SttsEntry[] {
	const view = new DataView(data.buffer, data.byteOffset, data.length);
	const entryCount = view.getUint32(4);
	const entries: SttsEntry[] = [];
	for (let i = 0; i < entryCount; i++) {
		entries.push({
			sampleCount: view.getUint32(8 + i * 8),
			sampleDelta: view.getUint32(12 + i * 8),
		});
	}
	return entries;
}

// ── Sample map resolver ──────────────────────────────────────────────

function buildSampleMap(
	stsz: number[],
	stco: number[],
	stsc: StscEntry[],
	stts: SttsEntry[],
	timescale: number,
): Mp4Sample[] {
	const samples: Mp4Sample[] = [];
	const totalSamples = stsz.length;

	// Build per-sample byte offsets using stsc + stco + stsz
	let sampleIndex = 0;
	for (
		let chunkIndex = 0;
		chunkIndex < stco.length && sampleIndex < totalSamples;
		chunkIndex++
	) {
		// Find how many samples are in this chunk
		const chunkNum = chunkIndex + 1; // 1-based
		let samplesInChunk = 0;
		for (let e = stsc.length - 1; e >= 0; e--) {
			if (chunkNum >= stsc[e].firstChunk) {
				samplesInChunk = stsc[e].samplesPerChunk;
				break;
			}
		}

		let byteOffset = stco[chunkIndex];
		for (let s = 0; s < samplesInChunk && sampleIndex < totalSamples; s++) {
			samples.push({
				byteOffset,
				size: stsz[sampleIndex],
				timestampUs: 0, // computed below
			});
			byteOffset += stsz[sampleIndex];
			sampleIndex++;
		}
	}

	// Assign timestamps from stts
	let sampleTs = 0;
	let sttsIndex = 0;
	let sttsRemaining = stts.length > 0 ? stts[0].sampleCount : 0;
	for (let i = 0; i < samples.length; i++) {
		const delta = stts[sttsIndex]?.sampleDelta ?? 1024;
		samples[i].timestampUs = Math.round((sampleTs / timescale) * 1_000_000);
		sampleTs += delta;
		sttsRemaining--;
		if (sttsRemaining === 0 && sttsIndex < stts.length - 1) {
			sttsIndex++;
			sttsRemaining = stts[sttsIndex].sampleCount;
		}
	}

	return samples;
}

// ── mp4a + esds parsing from stsd ────────────────────────────────────

interface Mp4aInfo {
	channelCount: number;
	sampleRate: number;
	esdsResult: EsdsResult;
}

function parseMp4a(data: Uint8Array): Mp4aInfo | null {
	// mp4a sample entry:
	// reserved (6B) + data_ref_index (2B) = 8
	// reserved (8B)
	// channel_count (2B) at offset 16
	// sample_size (2B) at offset 18
	// reserved (4B) at offset 20
	// sample_rate (4B as 16.16 fixed-point) at offset 24
	if (data.length < 28) return null;

	const view = new DataView(data.buffer, data.byteOffset, data.length);
	const channelCount = view.getUint16(16);
	const sampleRate = view.getUint16(24); // integer part of 16.16 fixed-point

	// Find esds box within mp4a (after the 28-byte fixed header)
	let offset = 28;
	while (offset + 8 <= data.length) {
		const box = readBoxHeader(data, offset);
		if (!box || box.size < 8) break;
		if (box.type === "esds") {
			const esdsData = data.slice(offset + box.headerSize, offset + box.size);
			const esdsResult = parseEsds(esdsData);
			if (esdsResult) {
				return { channelCount, sampleRate, esdsResult };
			}
		}
		offset += box.size;
	}
	return null;
}

// ── Main MP4 parser ──────────────────────────────────────────────────

export function parseMp4(buf: Uint8Array): Mp4ParseResult | null {
	// Step 1: Find moov and mdat at top level
	let moovData: Uint8Array | null = null;
	let mdatOffset = 0;
	let mdatSize = 0;

	let offset = 0;
	while (offset < buf.length) {
		const box = readBoxHeader(buf, offset);
		if (!box || box.size < 8) break;

		if (box.type === "moov") {
			moovData = buf.slice(offset + box.headerSize, offset + box.size);
		} else if (box.type === "mdat") {
			mdatOffset = offset + box.headerSize;
			mdatSize = box.size - box.headerSize;
		}

		offset += box.size;
	}

	if (!moovData) return null;

	// Step 2: Parse moov → find the audio trak
	const trackResult = parseAudioTrackFromMoov(moovData);
	if (!trackResult) return null;

	return {
		track: trackResult.track,
		samples: trackResult.samples,
		mdatOffset,
		mdatSize,
	};
}

interface TrackParseResult {
	track: Mp4AudioTrack;
	samples: Mp4Sample[];
}

function parseAudioTrackFromMoov(moov: Uint8Array): TrackParseResult | null {
	// Iterate trak boxes within moov
	let offset = 0;
	while (offset < moov.length) {
		const box = readBoxHeader(moov, offset);
		if (!box || box.size < 8) break;

		if (box.type === "trak") {
			const trakData = moov.slice(offset + box.headerSize, offset + box.size);
			const result = parseAudioTrak(trakData);
			if (result) return result;
		}

		offset += box.size;
	}
	return null;
}

function parseAudioTrak(trak: Uint8Array): TrackParseResult | null {
	// Find mdia box
	let offset = 0;
	while (offset < trak.length) {
		const box = readBoxHeader(trak, offset);
		if (!box || box.size < 8) break;

		if (box.type === "mdia") {
			const mdiaData = trak.slice(offset + box.headerSize, offset + box.size);
			return parseAudioMdia(mdiaData);
		}

		offset += box.size;
	}
	return null;
}

function parseAudioMdia(mdia: Uint8Array): TrackParseResult | null {
	let isAudioTrack = false;
	let timescale = 0;
	let minfData: Uint8Array | null = null;

	let offset = 0;
	while (offset < mdia.length) {
		const box = readBoxHeader(mdia, offset);
		if (!box || box.size < 8) break;

		const boxData = mdia.slice(offset + box.headerSize, offset + box.size);

		if (box.type === "hdlr") {
			// FullBox: version(1) + flags(3) + pre_defined(4) + handler_type(4)
			if (boxData.length >= 12) {
				const handlerType = String.fromCharCode(
					boxData[8],
					boxData[9],
					boxData[10],
					boxData[11],
				);
				isAudioTrack = handlerType === "soun";
			}
		} else if (box.type === "mdhd") {
			// FullBox: version(1) + flags(3)
			// v0: creation_time(4) + modification_time(4) + timescale(4) → offset 12
			// v1: creation_time(8) + modification_time(8) + timescale(4) → offset 20
			if (boxData.length >= 24) {
				const version = boxData[0];
				if (version === 0) {
					const view = new DataView(
						boxData.buffer,
						boxData.byteOffset,
						boxData.length,
					);
					timescale = view.getUint32(12);
				} else {
					const view = new DataView(
						boxData.buffer,
						boxData.byteOffset,
						boxData.length,
					);
					timescale = view.getUint32(20);
				}
			}
		} else if (box.type === "minf") {
			minfData = boxData;
		}

		offset += box.size;
	}

	if (!isAudioTrack || !minfData || timescale === 0) return null;

	return parseAudioMinf(minfData, timescale);
}

function parseAudioMinf(
	minf: Uint8Array,
	timescale: number,
): TrackParseResult | null {
	// Find stbl box
	let offset = 0;
	while (offset < minf.length) {
		const box = readBoxHeader(minf, offset);
		if (!box || box.size < 8) break;

		if (box.type === "stbl") {
			const stblData = minf.slice(offset + box.headerSize, offset + box.size);
			return parseStbl(stblData, timescale);
		}

		offset += box.size;
	}
	return null;
}

function parseStbl(
	stbl: Uint8Array,
	timescale: number,
): TrackParseResult | null {
	let mp4aInfo: Mp4aInfo | null = null;
	let stszData: number[] | null = null;
	let stcoData: number[] | null = null;
	let stscData: StscEntry[] | null = null;
	let sttsData: SttsEntry[] | null = null;

	let offset = 0;
	while (offset < stbl.length) {
		const box = readBoxHeader(stbl, offset);
		if (!box || box.size < 8) break;

		const boxData = stbl.slice(offset + box.headerSize, offset + box.size);

		if (box.type === "stsd") {
			// FullBox: version(1) + flags(3) + entry_count(4) = 8
			// Then sample entries follow
			if (boxData.length >= 8) {
				const entryData = boxData.slice(8);
				// Look for mp4a box in entries
				let entryOffset = 0;
				while (entryOffset < entryData.length) {
					const entryBox = readBoxHeader(entryData, entryOffset);
					if (!entryBox || entryBox.size < 8) break;
					if (entryBox.type === "mp4a") {
						const mp4aData = entryData.slice(
							entryOffset + entryBox.headerSize,
							entryOffset + entryBox.size,
						);
						mp4aInfo = parseMp4a(mp4aData);
					}
					entryOffset += entryBox.size;
				}
			}
		} else if (box.type === "stsz") {
			stszData = parseStsz(boxData);
		} else if (box.type === "stco") {
			stcoData = parseStco(boxData);
		} else if (box.type === "co64") {
			stcoData = parseCo64(boxData);
		} else if (box.type === "stsc") {
			stscData = parseStsc(boxData);
		} else if (box.type === "stts") {
			sttsData = parseStts(boxData);
		}

		offset += box.size;
	}

	if (!mp4aInfo || !stszData || !stcoData || !stscData || !sttsData) {
		return null;
	}

	const aot = mp4aInfo.esdsResult.audioObjectType;
	const samplesPerFrame = aot === 5 || aot === 29 ? 2048 : 1024;

	const track: Mp4AudioTrack = {
		codecString: codecStringFromAOT(aot),
		audioSpecificConfig: mp4aInfo.esdsResult.audioSpecificConfig,
		sampleRate: mp4aInfo.sampleRate,
		channelCount: mp4aInfo.channelCount,
		samplesPerFrame,
	};

	const samples = buildSampleMap(
		stszData,
		stcoData,
		stscData,
		sttsData,
		timescale,
	);

	return { track, samples };
}

// Re-export internal functions for testing
export {
	buildSampleMap as _buildSampleMap,
	codecStringFromAOT as _codecStringFromAOT,
	parseEsds as _parseEsds,
	parseMp4a as _parseMp4a,
	parseStco as _parseStco,
	parseStsc as _parseStsc,
	parseStsz as _parseStsz,
	parseStts as _parseStts,
	readBoxHeader as _readBoxHeader,
};
