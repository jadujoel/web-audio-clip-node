export type StreamFormat =
	| "mp3"
	| "ogg-opus"
	| "raw-opus-framed"
	| "webm-opus";

export function detectStreamFormat(url: string): StreamFormat {
	const normalized = url.toLowerCase();
	if (
		normalized.includes(".fopus") ||
		normalized.includes(".opuspkt")
	) {
		return "raw-opus-framed";
	}
	if (normalized.includes(".webm")) {
		return "webm-opus";
	}
	if (normalized.includes(".opus") || normalized.includes(".ogg")) {
		return "ogg-opus";
	}
	if (normalized.includes(".mp3")) {
		return "mp3";
	}
	return "mp3";
}

export function getDefaultUrlForFormat(format: StreamFormat): string {
	if (format === "ogg-opus") {
		return "../sounds/example.opus";
	}
	if (format === "raw-opus-framed") {
		return "";
	}
	if (format === "webm-opus") {
		return "../sounds/example.webm";
	}
	return "../sounds/example.mp3";
}

export function usesBufferedContainerDecode(format: StreamFormat): boolean {
	return format === "ogg-opus" || format === "webm-opus";
}
