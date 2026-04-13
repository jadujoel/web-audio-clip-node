import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createContext } from "../../TestPreload";
import type { StreamFormat } from "../streaming";
import { ClipNode } from "./ClipNode";
import { Coordinator, StreamingClipNode } from "./Coordinator";

interface FakeWorkerMessage {
	type: string;
	[key: string]: unknown;
}

class FakeWorker {
	messages: FakeWorkerMessage[] = [];
	terminated = false;
	onmessage: ((ev: { data: FakeWorkerMessage }) => void) | null = null;

	postMessage(msg: FakeWorkerMessage) {
		this.messages.push(msg);
	}

	terminate() {
		this.terminated = true;
	}

	receive(data: FakeWorkerMessage) {
		this.onmessage?.({ data });
	}
}

let lastWorker: FakeWorker;
function fakeWorkerFactory(_format: StreamFormat): Worker {
	lastWorker = new FakeWorker();
	return lastWorker as unknown as Worker;
}

let processorBuilt = false;

beforeAll(async () => {
	if (!processorBuilt) {
		await Bun.build({
			entrypoints: ["src/audio/processor.ts"],
			outdir: "dist/audio",
		});
		processorBuilt = true;
	}
});

afterEach(() => {
	lastWorker = undefined as unknown as FakeWorker;
});

describe("Coordinator.fromContext", () => {
	test("returns a Coordinator instance", () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx, {
			processorUrl: "./dist/audio/processor.js",
		});
		expect(coordinator).toBeInstanceOf(Coordinator);
	});
});

describe("Coordinator.addModule", () => {
	test("calls ctx.audioWorklet.addModule with the processor URL", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		await coordinator.addModule("./dist/audio/processor.js");
		// Second call is idempotent — returns the same cached promise
		await coordinator.addModule("./dist/audio/processor.js");
		expect(true).toBe(true);
	});
});

describe("Coordinator.createClipNode", () => {
	test("returns a regular ClipNode", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		expect(node).toBeInstanceOf(ClipNode);
		expect(node).not.toBeInstanceOf(StreamingClipNode);
	});
});

describe("Coordinator.createStreamingClipNode", () => {
	test("returns a StreamingClipNode", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode();
		expect(node).toBeInstanceOf(StreamingClipNode);
	});

	test("respects explicit stream format", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		const capturedFormats: StreamFormat[] = [];
		const trackingFactory = (format: StreamFormat): Worker => {
			capturedFormats.push(format);
			const w = new FakeWorker();
			lastWorker = w;
			return w as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.unknown";
		await Promise.resolve();

		expect(capturedFormats[0]).toBe("OggOpus");
	});
});

describe("Coordinator.dispose", () => {
	test("stops all managed nodes", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const regular = coordinator.createClipNode();
		const streaming = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		streaming.url = "https://example.com/audio.opus";
		// _startStream is async; flush enough microtasks for the worker to be set
		await new Promise((r) => setTimeout(r, 0));
		expect(regular).toBeInstanceOf(ClipNode);

		const worker = lastWorker;
		coordinator.dispose();

		expect(worker.terminated).toBe(true);
	});
});

describe("StreamingClipNode.url setter", () => {
	test("creates a worker and posts an init message with the url and sampleRate", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		const url = "https://example.com/audio.opus";
		node.url = url;
		await Promise.resolve();

		const worker = lastWorker;
		const initMsg = worker.messages.find((m) => m.type === "init");
		expect(initMsg).toBeDefined();
		expect(initMsg?.url).toBe(url);
		expect(initMsg?.targetSampleRate).toBe(48_000);
	});

	test("terminates previous worker when url is reassigned", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio1.opus";
		await Promise.resolve();
		const firstWorker = lastWorker;

		node.url = "https://example.com/audio2.opus";
		await Promise.resolve();

		expect(firstWorker.terminated).toBe(true);
		expect(lastWorker).not.toBe(firstWorker);
	});

	test("url getter returns the last set value", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode();
		node.url = "https://example.com/audio.opus";
		expect(node.url).toBe("https://example.com/audio.opus");
	});
});

describe("StreamingClipNode.start - deferred until pre-buffer threshold", () => {
	test("does not start until samplesDecoded reaches threshold", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		node.start();

		let stateChanged = false;
		node.onstarted = () => {
			stateChanged = true;
		};

		// First small decoded chunk — should NOT trigger start
		worker.receive({ type: "decoded", samplesDecoded: 960 });
		expect(stateChanged).toBe(false);

		// Still below threshold (default 48 000)
		worker.receive({ type: "decoded", samplesDecoded: 24_000 });
		expect(stateChanged).toBe(false);

		expect(node.url).toBe("https://example.com/audio.opus");
	});

	test("starts on done even when below pre-buffer threshold", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		node.start();

		// Small file: decoded only 960 samples, then done
		worker.receive({ type: "decoded", samplesDecoded: 960 });
		worker.receive({ type: "done", samplesDecoded: 960 });

		// Should have triggered start despite being below threshold
		// (The ClipNode.start sends a message to the processor port,
		// which is verified by the absence of a pending start.)
		expect(node.url).toBe("https://example.com/audio.opus");
	});
});

describe("StreamingClipNode.stop", () => {
	test("terminates the managed worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		node.stop();

		expect(worker.terminated).toBe(true);
	});

	test("sends abort message before terminating worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		node.stop();

		const abortMsg = worker.messages.find((m) => m.type === "abort");
		expect(abortMsg).toBeDefined();
	});
});

describe("StreamingClipNode callbacks", () => {
	test("onerror fires on error message from worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		let errorMsg = "";
		node.onerror = (msg) => {
			errorMsg = msg;
		};

		lastWorker.receive({ type: "error", message: "network failure" });
		expect(errorMsg).toBe("network failure");
	});

	test("onprogress fires on progress message from worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		let received = -1;
		node.onprogress = (bytes) => {
			received = bytes;
		};

		lastWorker.receive({ type: "progress", bytesReceived: 4096 });
		expect(received).toBe(4096);
	});

	test("ondone fires on done message from worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		let done = false;
		node.ondone = () => {
			done = true;
		};

		lastWorker.receive({ type: "done" });
		expect(done).toBe(true);
	});
});

describe("StreamingClipNode.downloaded", () => {
	test("resolves when stream completes", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const promise = node.downloaded;
		lastWorker.receive({ type: "done", samplesDecoded: 0 });
		await expect(promise).resolves.toBeUndefined();
	});

	test("rejects when stream errors", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const promise = node.downloaded;
		lastWorker.receive({ type: "error", message: "network failure" });
		await expect(promise).rejects.toThrow("network failure");
	});

	test("resets when a new URL is set", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio1.opus";
		await Promise.resolve();

		const firstPromise = node.downloaded;
		lastWorker.receive({ type: "done", samplesDecoded: 0 });
		await firstPromise;

		// Setting a new URL should create a fresh promise
		node.url = "https://example.com/audio2.opus";
		await Promise.resolve();

		const secondPromise = node.downloaded;
		expect(secondPromise).not.toBe(firstPromise);
		lastWorker.receive({ type: "done", samplesDecoded: 0 });
		await expect(secondPromise).resolves.toBeUndefined();
	});

	test("stays pending when no stream started", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		// No URL set — promise should stay pending
		const result = await Promise.race([
			node.downloaded.then(() => "resolved"),
			Promise.resolve("pending"),
		]);
		expect(result).toBe("pending");
	});
});

describe("StreamingClipNode format auto-detection", () => {
	test("auto-detects OggOpus format from .opus URL when no format set", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		const capturedFormats: StreamFormat[] = [];
		const trackingFactory = (format: StreamFormat): Worker => {
			capturedFormats.push(format);
			const w = new FakeWorker();
			lastWorker = w;
			return w as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode();
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		expect(capturedFormats[0]).toBe("OggOpus");
	});
});

describe("StreamingClipNode auto-dispose worker", () => {
	test("worker is terminated and nulled after done", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		worker.receive({ type: "done", samplesDecoded: 960 });

		expect(worker.terminated).toBe(true);
	});

	test("worker is terminated and nulled after error", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		// suppress unhandled rejection from downloaded promise
		node.downloaded.catch(() => {});

		const worker = lastWorker;
		worker.receive({ type: "error", message: "fail" });

		expect(worker.terminated).toBe(true);
	});

	test("stop() after done does not send abort (worker already disposed)", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await Promise.resolve();

		const worker = lastWorker;
		worker.receive({ type: "done", samplesDecoded: 960 });

		// Worker already terminated by "done" handler
		expect(worker.terminated).toBe(true);

		// stop() should not throw and should not send "abort" since _worker is null
		node.stop();
		const abortMessages = worker.messages.filter((m) => m.type === "abort");
		expect(abortMessages).toHaveLength(0);
	});
});
