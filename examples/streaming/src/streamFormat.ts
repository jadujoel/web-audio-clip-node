import type { StreamFormat } from "./clip-node-lib";

export function getDefaultUrlForFormat(format: StreamFormat): string {
	if (format === "Aac") {
		return "../sounds/example.aac";
	}
	if (format === "Flac") {
		return "../sounds/example.flac";
	}
	if (format === "Mp4Aac") {
		return "../sounds/example.m4a";
	}
	if (format === "OggFlac") {
		return "../sounds/example-flac.oga";
	}
	if (format === "OggOpus") {
		return "../sounds/example.opus";
	}
	if (format === "OggVorbis") {
		return "../sounds/example-vorbis.ogg";
	}
	if (format === "RawOpusFramed") {
		return "";
	}
	if (format === "WebmOpus") {
		return "../sounds/example.webm";
	}
	if (format === "WebmVorbis") {
		return "../sounds/example-vorbis.webm";
	}
	return "../sounds/example.mp3";
}
