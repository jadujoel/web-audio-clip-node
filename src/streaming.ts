export type StreamFormat = "Mp3" | "OggOpus" | "RawOpusFramed" | "WebmOpus";

export const workerFileMap: Record<StreamFormat, string> = {
	Mp3: "mp3-decode-worker.min.js",
	OggOpus: "ogg-opus-decode-worker.min.js",
	RawOpusFramed: "raw-opus-framed-decode-worker.min.js",
	WebmOpus: "webm-opus-decode-worker.min.js",
};

export function getStreamingWorkerUrl(format: StreamFormat): string {
	const file = workerFileMap[format];
	return new URL(`./workers/${file}`, import.meta.url).href;
}

export function createStreamingWorker(format: StreamFormat): Worker {
	return new Worker(getStreamingWorkerUrl(format), { type: "classic" });
}

export function detectStreamFormat(url: string): StreamFormat {
	const normalized = url.toLowerCase();
	if (normalized.includes(".fopus") || normalized.includes(".opuspkt")) {
		return "RawOpusFramed";
	}
	if (normalized.includes(".webm")) {
		return "WebmOpus";
	}
	if (normalized.includes(".opus") || normalized.includes(".ogg")) {
		return "OggOpus";
	}
	if (normalized.includes(".mp3")) {
		return "Mp3";
	}
	return "Mp3";
}

export function usesBufferedContainerDecode(format: StreamFormat): boolean {
	return format === "OggOpus" || format === "WebmOpus";
}
