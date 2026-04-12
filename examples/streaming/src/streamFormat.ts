import type { StreamFormat } from "./clip-node-lib";

export function getDefaultUrlForFormat(format: StreamFormat): string {
	if (format === "OggOpus") {
		return "../sounds/example.opus";
	}
	if (format === "RawOpusFramed") {
		return "";
	}
	if (format === "WebmOpus") {
		return "../sounds/example.webm";
	}
	return "../sounds/example.mp3";
}
