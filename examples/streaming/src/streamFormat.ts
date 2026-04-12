export type StreamFormat = "mp3" | "opus";

export function detectStreamFormat(url: string): StreamFormat {
	const normalized = url.toLowerCase();
	if (normalized.includes(".opus") || normalized.includes(".ogg")) {
		return "opus";
	}
	if (normalized.includes(".mp3")) {
		return "mp3";
	}
	return "mp3";
}

export function getDefaultUrlForFormat(format: StreamFormat): string {
	if (format === "opus") {
		return "example.opus";
	}
	return "https://jadujoel.github.io/web-audio-clip-node/example.mp3";
}
