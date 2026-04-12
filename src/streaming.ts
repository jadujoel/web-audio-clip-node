export type StreamingWorkerFormat =
	| "mp3"
	| "ogg-opus"
	| "raw-opus-framed"
	| "webm-opus";

const workerFileMap: Record<StreamingWorkerFormat, string> = {
	mp3: "mp3-decode-worker.min.js",
	"ogg-opus": "ogg-opus-decode-worker.min.js",
	"raw-opus-framed": "raw-opus-framed-decode-worker.min.js",
	"webm-opus": "webm-opus-decode-worker.min.js",
};

export function getStreamingWorkerUrl(format: StreamingWorkerFormat): string {
	const file = workerFileMap[format];
	return new URL(`./workers/${file}`, import.meta.url).href;
}

export function createStreamingWorker(format: StreamingWorkerFormat): Worker {
	return new Worker(getStreamingWorkerUrl(format), { type: "classic" });
}
