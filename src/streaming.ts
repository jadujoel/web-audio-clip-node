import { createWorkerFromBlob, getWorkerCode } from "./workers/workerUrl";

export type StreamFormat =
	| "Aac"
	| "Flac"
	| "Mp3"
	| "Mp4Aac"
	| "OggFlac"
	| "OggOpus"
	| "OggVorbis"
	| "RawOpusFramed"
	| "WebmOpus"
	| "WebmVorbis";

export const workerFileMap = {
	Aac: "aac-adts-decode-worker.min.js",
	Flac: "flac-decode-worker.min.js",
	Mp3: "mp3-decode-worker.min.js",
	Mp4Aac: "mp4-aac-decode-worker.min.js",
	OggFlac: "ogg-flac-decode-worker.min.js",
	OggOpus: "ogg-opus-decode-worker.min.js",
	OggVorbis: "ogg-vorbis-decode-worker.min.js",
	RawOpusFramed: "raw-opus-framed-decode-worker.min.js",
	WebmOpus: "webm-opus-decode-worker.min.js",
	WebmVorbis: "webm-vorbis-decode-worker.min.js",
} as const;
workerFileMap satisfies Record<StreamFormat, string>;

export function createCdnWorkerFactory(): (
	format: StreamFormat,
) => Promise<Worker> {
	return async (format: StreamFormat) => {
		const code = await getWorkerCode(format);
		return createWorkerFromBlob(code);
	};
}

export function getStreamingWorkerUrl(format: StreamFormat): string {
	const file = workerFileMap[format];
	return new URL(`./workers/${file}`, import.meta.url).href;
}

export async function createStreamingWorker(
	format: StreamFormat,
): Promise<Worker> {
	const code = await getWorkerCode(format);
	return createWorkerFromBlob(code);
}

export function detectStreamFormat(url: string): StreamFormat {
	// Check compound patterns first (before simple extension match)
	const normalized = url.toLowerCase();
	if (normalized.includes(".fopus") || normalized.includes(".opuspkt")) {
		return "RawOpusFramed";
	}
	if (normalized.includes("-vorbis.webm")) {
		return "WebmVorbis";
	}
	if (normalized.includes("-flac.oga") || normalized.includes(".flac.ogg")) {
		return "OggFlac";
	}

	// Simple extension match
	const ext = getExtensionFromUrl(url);
	if (ext) {
		const mapped = EXTENSION_MAP[ext];
		if (mapped) return mapped;
	}

	return "Mp3";
}

const EXTENSION_MAP: Record<string, StreamFormat> = {
	webm: "WebmOpus",
	opus: "OggOpus",
	oga: "OggVorbis",
	ogg: "OggVorbis",
	flac: "Flac",
	mp3: "Mp3",
	aac: "Aac",
	m4a: "Mp4Aac",
	mp4: "Mp4Aac",
	fopus: "RawOpusFramed",
	opuspkt: "RawOpusFramed",
};

function getExtensionFromUrl(url: string): string | null {
	try {
		const pathname = new URL(url).pathname;
		const ext = pathname.split(".").pop()?.toLowerCase();
		return ext && ext.length <= 8 ? ext : null;
	} catch {
		// Relative URLs or malformed
		const cleaned = url.split("?")[0].split("#")[0];
		const ext = cleaned.split(".").pop()?.toLowerCase();
		return ext && ext.length <= 8 ? ext : null;
	}
}

const CONTENT_TYPE_MAP: Record<string, StreamFormat> = {
	"audio/opus": "OggOpus",
	"audio/ogg": "OggOpus",
	"audio/ogg; codecs=opus": "OggOpus",
	"audio/ogg; codecs=vorbis": "OggVorbis",
	"audio/ogg; codecs=flac": "OggFlac",
	"audio/webm": "WebmOpus",
	"audio/webm; codecs=opus": "WebmOpus",
	"audio/webm; codecs=vorbis": "WebmVorbis",
	"audio/mpeg": "Mp3",
	"audio/mp3": "Mp3",
	"audio/mp4": "Mp4Aac",
	"audio/aac": "Aac",
	"audio/flac": "Flac",
	"audio/x-flac": "Flac",
};

export function formatFromContentType(
	contentType: string,
): StreamFormat | null {
	const ct = contentType.toLowerCase().trim();
	const mapped = CONTENT_TYPE_MAP[ct];
	if (mapped) return mapped;
	const baseType = ct.split(";")[0].trim();
	return CONTENT_TYPE_MAP[baseType] ?? null;
}

export async function detectStreamFormatFromResponse(
	url: string,
	signal?: AbortSignal,
): Promise<StreamFormat> {
	const fromExt = detectStreamFormat(url);
	// If extension gave a definitive match (not the Mp3 fallback), use it
	if (fromExt !== "Mp3") return fromExt;

	// Check if URL actually has an mp3 extension (vs fallback)
	const ext = getExtensionFromUrl(url);
	if (ext === "mp3") return fromExt;

	// No definitive extension — try HEAD request for Content-Type
	try {
		const resp = await fetch(url, { method: "HEAD", signal });
		const ct = resp.headers.get("Content-Type");
		if (ct) {
			const mapped = formatFromContentType(ct);
			if (mapped) return mapped;
		}
	} catch {
		// HEAD not supported or CORS issue — continue with fallback
	}

	return fromExt;
}

export function usesBufferedContainerDecode(format: StreamFormat): boolean {
	return (
		format === "Flac" ||
		format === "OggFlac" ||
		format === "OggOpus" ||
		format === "OggVorbis" ||
		format === "WebmOpus" ||
		format === "WebmVorbis" ||
		format === "Mp4Aac"
	);
}
