import type { StreamFormat } from "../streaming";
import { oggOpusWorkerCode } from "./ogg-opus-worker-code";

/** Create a Worker from embedded code (blob URL, zero fetch). */
export function createWorkerFromBlob(code: string): Worker {
	const blob = new Blob([code], {
		type: "application/javascript",
	});
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url, { type: "classic" });
	URL.revokeObjectURL(url);
	return worker;
}

/**
 * Lazily load the embedded worker code for a given format.
 * Uses dynamic `import()` so bundlers can code-split per format.
 */
export async function getWorkerCode(format: StreamFormat): Promise<string> {
	switch (format) {
		case "Aac":
			return (await import("./aac-worker-code")).aacWorkerCode;
		case "Flac":
			return (await import("./flac-worker-code")).flacWorkerCode;
		case "Mp3":
			return (await import("./mp3-worker-code")).mp3WorkerCode;
		case "Mp4Aac":
			return (await import("./mp4-aac-worker-code")).mp4AacWorkerCode;
		case "OggFlac":
			return (await import("./ogg-flac-worker-code")).oggFlacWorkerCode;
		case "OggOpus":
			return oggOpusWorkerCode;
		case "OggVorbis":
			return (await import("./ogg-vorbis-worker-code")).oggVorbisWorkerCode;
		case "RawOpusFramed":
			return (await import("./raw-opus-framed-worker-code"))
				.rawOpusFramedWorkerCode;
		case "WebmOpus":
			return (await import("./webm-opus-worker-code")).webmOpusWorkerCode;
		case "WebmVorbis":
			return (await import("./webm-vorbis-worker-code")).webmVorbisWorkerCode;
	}
}

/** Create a Worker from the embedded OggOpus decode worker blob. Zero-config, default for npm users. */
export function createOggOpusWorkerFromBlob(): Worker {
	return createWorkerFromBlob(oggOpusWorkerCode);
}
