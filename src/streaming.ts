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

export const workerFileMap: Record<StreamFormat, string> = {
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
};

export function getStreamingWorkerUrl(format: StreamFormat): string {
	const file = workerFileMap[format];
	return new URL(`./workers/${file}`, import.meta.url).href;
}

export async function createStreamingWorker(
	format: StreamFormat,
): Promise<Worker> {
	const url = getStreamingWorkerUrl(format);
	// Cross-origin worker scripts are blocked by browsers.
	// Fetch the script and load it via a blob URL instead.
	if (new URL(url).origin !== location.origin) {
		const res = await fetch(url);
		const text = await res.text();
		const blob = new Blob([text], { type: "application/javascript" });
		const blobUrl = URL.createObjectURL(blob);
		const worker = new Worker(blobUrl, { type: "classic" });
		URL.revokeObjectURL(blobUrl);
		return worker;
	}
	return new Worker(url, { type: "classic" });
}

export function detectStreamFormat(url: string): StreamFormat {
	const normalized = url.toLowerCase();
	if (normalized.includes(".fopus") || normalized.includes(".opuspkt")) {
		return "RawOpusFramed";
	}
	if (normalized.includes("-vorbis.webm")) {
		return "WebmVorbis";
	}
	if (normalized.includes(".webm")) {
		return "WebmOpus";
	}
	if (normalized.includes(".opus")) {
		return "OggOpus";
	}
	if (normalized.includes("-flac.oga") || normalized.includes(".flac.ogg")) {
		return "OggFlac";
	}
	if (normalized.includes(".oga") || normalized.includes(".ogg")) {
		return "OggVorbis";
	}
	if (normalized.includes(".flac")) {
		return "Flac";
	}
	if (normalized.includes(".mp3")) {
		return "Mp3";
	}
	if (normalized.includes(".aac")) {
		return "Aac";
	}
	if (normalized.includes(".m4a") || normalized.includes(".mp4")) {
		return "Mp4Aac";
	}
	return "Mp3";
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
