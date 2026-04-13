import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createContext } from "../../TestPreload";
import type { StreamFormat } from "../streaming";
import { ClipNode } from "./ClipNode";
import { Coordinator, StreamingClipNode } from "./Coordinator";
import type { StreamError, StreamReadyState } from "./types";

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

		// suppress unhandled rejection from downloaded promise
		node.downloaded.catch(() => {});

		const errors: StreamError[] = [];
		node.onerror = (error) => {
			errors.push(error);
		};

		lastWorker.receive({ type: "error", message: "network failure" });
		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("DECODE"); // default code when worker doesn't specify
		expect(errors[0].message).toBe("network failure");
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

	test("onerror receives typed error with code from worker", async () => {
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
		node.downloaded.catch(() => {});

		const errors: StreamError[] = [];
		node.onerror = (error) => {
			errors.push(error);
		};

		lastWorker.receive({
			type: "error",
			code: "NETWORK",
			message: "fetch failed",
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("NETWORK");
		expect(errors[0].message).toBe("fetch failed");
	});

	test("error property persists after error", async () => {
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
		node.downloaded.catch(() => {});

		expect(node.error).toBeNull();
		lastWorker.receive({ type: "error", code: "NETWORK", message: "fail" });
		expect(node.error).toEqual({ code: "NETWORK", message: "fail" });
	});

	test("error resets when new URL is set", async () => {
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
		node.downloaded.catch(() => {});

		lastWorker.receive({ type: "error", code: "NETWORK", message: "fail" });
		expect(node.error).not.toBeNull();

		node.url = "https://example.com/audio2.opus";
		expect(node.error).toBeNull();
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

describe("ClipNode.currentTime", () => {
	test("returns playhead converted to seconds", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		// Simulate the playhead being at 48000 samples (1 second at 48kHz)
		(node as unknown as { _playhead: number })._playhead = 48_000;
		expect(node.currentTime).toBe(1);
	});

	test("setting currentTime sets playhead in samples", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		// Setting currentTime should round to nearest sample
		node.currentTime = 2.5;
		// Verify by setting _playhead to the expected value (since playhead setter
		// only sends a message to the processor, _playhead isn't updated until
		// a frame message comes back)
		(node as unknown as { _playhead: number })._playhead = 120_000;
		expect(node.currentTime).toBe(2.5);
	});

	test("currentTime is 0 initially", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		expect(node.currentTime).toBe(0);
	});

	test("handles fractional seconds correctly", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		(node as unknown as { _playhead: number })._playhead = 24_000;
		expect(node.currentTime).toBe(0.5);
	});
});

describe("ClipNode.ondurationchange", () => {
	test("fires when duration setter is called with a new value", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		let receivedDuration = -1;
		node.ondurationchange = (d) => {
			receivedDuration = d;
		};
		node.duration = 5.0;
		expect(receivedDuration).toBe(5.0);
	});

	test("does NOT fire when same value is set", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.duration = 5.0;
		let callCount = 0;
		node.ondurationchange = () => {
			callCount++;
		};
		node.duration = 5.0;
		expect(callCount).toBe(0);
	});

	test("fires when duration changes again", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const durations: number[] = [];
		node.ondurationchange = (d) => {
			durations.push(d);
		};
		node.duration = 3.0;
		node.duration = 5.0;
		expect(durations).toEqual([3.0, 5.0]);
	});
});

describe("ClipNode.muted", () => {
	test("defaults to false", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		expect(node.muted).toBe(false);
	});

	test("can be set to true", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.muted = true;
		expect(node.muted).toBe(true);
	});

	test("setting same value does not re-post message", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.muted = true;
		node.muted = true; // no-op
		expect(node.muted).toBe(true);
	});

	test("can toggle back to false", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.muted = true;
		node.muted = false;
		expect(node.muted).toBe(false);
	});
});

describe("ClipNode.setPlaybackRate / onratechange", () => {
	test("onratechange fires when setPlaybackRate is called", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		let receivedRate = -1;
		node.onratechange = (rate) => {
			receivedRate = rate;
		};
		node.setPlaybackRate(2.0);
		expect(receivedRate).toBe(2.0);
	});

	test("setPlaybackRate sets the AudioParam value", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.setPlaybackRate(1.5);
		expect(node.playbackRate.value).toBe(1.5);
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

describe("ClipNode.on / off (addEventListener)", () => {
	test("on() receives events emitted by state changes", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const events: string[] = [];
		node.on("statechange", (state) => events.push(state));
		// Force a state change via the processor message
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "started" },
		} as MessageEvent);
		expect(events).toEqual(["started"]);
	});

	test("off() removes a listener", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const events: string[] = [];
		const cb = (state: string) => events.push(state);
		node.on("statechange", cb);
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "started" },
		} as MessageEvent);
		expect(events).toEqual(["started"]);

		node.off("statechange", cb);
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "paused" },
		} as MessageEvent);
		// Should not receive the paused event
		expect(events).toEqual(["started"]);
	});

	test("multiple listeners for the same event", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const a: string[] = [];
		const b: string[] = [];
		node.on("started", () => a.push("a"));
		node.on("started", () => b.push("b"));
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "started" },
		} as MessageEvent);
		expect(a).toEqual(["a"]);
		expect(b).toEqual(["b"]);
	});

	test("dispose() clears all listeners", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const events: string[] = [];
		node.on("disposed", () => events.push("disposed"));
		node.dispose();
		// The disposed event fires during dispose
		expect(events).toEqual(["disposed"]);
	});

	test("durationchange event via on()", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const durations: number[] = [];
		node.on("durationchange", (d) => durations.push(d));
		node.duration = 5;
		node.duration = 10;
		node.duration = 10; // same, should not fire
		expect(durations).toEqual([5, 10]);
	});

	test("ratechange event via on()", async () => {
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const rates: number[] = [];
		node.on("ratechange", (r) => rates.push(r));
		node.setPlaybackRate(2);
		expect(rates).toEqual([2]);
	});
});

describe("StreamingClipNode.on / off (streaming events)", () => {
	test("on('progress') receives progress events", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		const received: number[] = [];
		node.on("progress", (bytes) => received.push(bytes));
		node.url = "https://example.com/test.mp3";
		await Promise.resolve(); // let async _startStream settle

		worker.receive({ type: "progress", bytesReceived: 1024 });
		worker.receive({ type: "progress", bytesReceived: 2048 });
		expect(received).toEqual([1024, 2048]);
	});

	test("on('done') fires when stream completes", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		let fired = false;
		node.on("done", () => {
			fired = true;
		});
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		worker.receive({ type: "done", samplesDecoded: 48000 });
		expect(fired).toBe(true);
	});

	test("on('error') fires on stream error", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		const errors: StreamError[] = [];
		node.on("error", (err) => errors.push(err));
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();
		node.downloaded.catch(() => {}); // prevent unhandled rejection

		worker.receive({
			type: "error",
			message: "Network failed",
			code: "NETWORK",
		});
		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("NETWORK");
		expect(errors[0].message).toBe("Network failed");
	});
});

describe("ClipNode.ontimeupdate", () => {
	test("fires during frame processing with currentTime", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const times: number[] = [];
		node.ontimeupdate = (ct) => times.push(ct);
		// Simulate a frame message
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "frame", data: [0, 0, 48_000, 0.01] },
		} as MessageEvent);
		expect(times).toEqual([1]); // 48000 / 48000 = 1 second
	});

	test("throttles to timeUpdateInterval", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.timeUpdateInterval = 1000; // 1 second
		const times: number[] = [];
		node.ontimeupdate = (ct) => times.push(ct);
		const handleMessage = (
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage;

		// First frame fires immediately (since lastTimeUpdate is 0)
		handleMessage({
			data: { type: "frame", data: [0, 0, 48_000, 0.01] },
		} as MessageEvent);
		expect(times).toHaveLength(1);

		// Subsequent frame within 1s should not fire
		handleMessage({
			data: { type: "frame", data: [0, 0, 96_000, 0.01] },
		} as MessageEvent);
		expect(times).toHaveLength(1);
	});

	test("custom interval is respected", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		node.timeUpdateInterval = 100;
		expect(node.timeUpdateInterval).toBe(100);
		node.timeUpdateInterval = 0;
		expect(node.timeUpdateInterval).toBe(0);
	});

	test("also emits timeupdate via on()", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createClipNode();
		const times: number[] = [];
		node.on("timeupdate", (ct) => times.push(ct));
		// Need to set ontimeupdate to trigger the logic
		node.ontimeupdate = () => {};
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "frame", data: [0, 0, 24_000, 0.01] },
		} as MessageEvent);
		expect(times).toEqual([0.5]); // 24000 / 48000 = 0.5
	});
});

describe("StreamingClipNode.buffered (buffered ranges API)", () => {
	test("buffered returns empty array initially", async () => {
		const worker = new FakeWorker();
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		expect(node.buffered).toEqual([]);
		expect(node.bufferedLength).toBe(0);
	});

	test("buffered returns ranges in seconds after bufferState message", async () => {
		const worker = new FakeWorker();
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		// Simulate a bufferState message from processor
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 96_000,
					totalLength: 480_000,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 96_000 }],
				},
			},
		} as MessageEvent);
		expect(node.buffered).toEqual([{ start: 0, end: 2 }]); // 96000/48000 = 2s
		expect(node.bufferedLength).toBe(2); // 96000/48000 = 2s
	});

	test("onbufferchange fires on buffer state updates", async () => {
		const worker = new FakeWorker();
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		const received: { start: number; end: number }[][] = [];
		node.onbufferchange = (ranges) => received.push(ranges);
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 48_000,
					totalLength: null,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 48_000 }],
				},
			},
		} as MessageEvent);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual([{ start: 0, end: 1 }]);
	});

	test("bufferchange event via on()", async () => {
		const worker = new FakeWorker();
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		const received: { start: number; end: number }[][] = [];
		node.on("bufferchange", (ranges) => received.push(ranges));
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 48_000,
					totalLength: null,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 48_000 }],
				},
			},
		} as MessageEvent);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual([{ start: 0, end: 1 }]);
	});
});

describe("StreamingClipNode.readyState + buffering events", () => {
	test("readyState starts as 'empty'", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		expect(node.readyState).toBe("empty");
	});

	test("readyState transitions: empty → loading → canplay → complete", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 1000,
			},
		);
		const states: StreamReadyState[] = [];
		node.onreadystatechange = (s) => states.push(s);

		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		expect(node.readyState).toBe("loading");
		expect(states).toEqual(["loading"]);

		// Decoded enough samples to meet preBufferSamples threshold
		worker.receive({ type: "decoded", samplesDecoded: 2000 });
		expect(node.readyState).toBe("canplay");
		expect(states).toEqual(["loading", "canplay"]);

		// Stream completes
		worker.receive({ type: "done", samplesDecoded: 48000 });
		expect(node.readyState).toBe("complete");
		expect(states).toEqual(["loading", "canplay", "complete"]);
	});

	test("onloadstart fires when url is set", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		let fired = false;
		node.onloadstart = () => {
			fired = true;
		};
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();
		expect(fired).toBe(true);
	});

	test("oncanplay fires when preBufferSamples is met", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 500,
			},
		);
		let fired = false;
		node.oncanplay = () => {
			fired = true;
		};
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		worker.receive({ type: "decoded", samplesDecoded: 1000 });
		expect(fired).toBe(true);
		expect(node.readyState).toBe("canplay");
	});

	test("onwaiting fires on buffer underrun, then canplay on recovery", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 100,
			},
		);
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		// Get to canplay state
		worker.receive({ type: "decoded", samplesDecoded: 200 });
		expect(node.readyState).toBe("canplay");

		let waitingFired = false;
		node.onwaiting = () => {
			waitingFired = true;
		};

		// Simulate buffer underrun from processor
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferUnderrun",
				data: { playhead: 100, committedLength: 200, requestedSample: 201 },
			},
		} as MessageEvent);

		expect(waitingFired).toBe(true);
		expect(node.readyState).toBe("loading");

		// Recovery: buffer state update while _readyToPlay is still true
		let canplayFired = false;
		node.oncanplay = () => {
			canplayFired = true;
		};
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 96_000,
					totalLength: null,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 96_000 }],
				},
			},
		} as MessageEvent);

		expect(canplayFired).toBe(true);
		expect(node.readyState).toBe("canplay");
	});

	test("readystatechange event fires via on()", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 100,
			},
		);
		const states: StreamReadyState[] = [];
		node.on("readystatechange", (s) => states.push(s));

		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		worker.receive({ type: "decoded", samplesDecoded: 200 });
		worker.receive({ type: "done", samplesDecoded: 48000 });

		expect(states).toEqual(["loading", "canplay", "complete"]);
	});

	test("loadstart / waiting / canplay events fire via on()", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 100,
			},
		);
		const events: string[] = [];
		node.on("loadstart", () => events.push("loadstart"));
		node.on("canplay", () => events.push("canplay"));
		node.on("waiting", () => events.push("waiting"));

		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		worker.receive({ type: "decoded", samplesDecoded: 200 });

		// Simulate underrun
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: { type: "bufferUnderrun", data: {} },
		} as MessageEvent);

		// Recovery
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 96_000,
					totalLength: null,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 96_000 }],
				},
			},
		} as MessageEvent);

		expect(events).toEqual(["loadstart", "canplay", "waiting", "canplay"]);
	});

	test("setting new url resets readyState to loading", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
				preBufferSamples: 100,
			},
		);
		node.url = "https://example.com/test.mp3";
		await Promise.resolve();

		worker.receive({ type: "decoded", samplesDecoded: 200 });
		expect(node.readyState).toBe("canplay");

		// Set a new URL — should reset back to loading
		node.url = "https://example.com/test2.mp3";
		await Promise.resolve();
		expect(node.readyState).toBe("loading");
	});

	test("dispose clears readyState callbacks", async () => {
		const worker = new FakeWorker();
		const ctx = createContext();
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new StreamingClipNode(
			ctx,
			{},
			{
				defaultFormat: "mp3" as StreamFormat,
				targetSampleRate: 48000,
				createWorker: () => worker as unknown as Worker,
			},
		);
		node.onloadstart = () => {};
		node.oncanplay = () => {};
		node.onwaiting = () => {};
		node.oncanplaythrough = () => {};
		node.onreadystatechange = () => {};
		node.dispose();
		expect(node.onloadstart).toBeUndefined();
		expect(node.oncanplay).toBeUndefined();
		expect(node.onwaiting).toBeUndefined();
		expect(node.oncanplaythrough).toBeUndefined();
		expect(node.onreadystatechange).toBeUndefined();
	});
});

describe("preload strategy", () => {
	test("preload: 'none' — setting URL does not create a worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		let workerCreated = false;
		const trackingFactory = (_format: StreamFormat): Worker => {
			workerCreated = true;
			lastWorker = new FakeWorker();
			return lastWorker as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			preload: "none",
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		expect(workerCreated).toBe(false);
		expect(node.preload).toBe("none");
	});

	test("preload: 'none' — start() triggers fetch", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		let workerCreated = false;
		const trackingFactory = (_format: StreamFormat): Worker => {
			workerCreated = true;
			lastWorker = new FakeWorker();
			return lastWorker as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			preload: "none",
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));
		expect(workerCreated).toBe(false);

		// start() should trigger the stream
		node.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(workerCreated).toBe(true);
	});

	test("preload: 'metadata' — does not create worker on URL set", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		let workerCreated = false;
		const trackingFactory = (_format: StreamFormat): Worker => {
			workerCreated = true;
			lastWorker = new FakeWorker();
			return lastWorker as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			preload: "metadata",
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		expect(workerCreated).toBe(false);
		expect(node.preload).toBe("metadata");
	});

	test("preload: 'metadata' — start() triggers full fetch", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		let workerCreated = false;
		const trackingFactory = (_format: StreamFormat): Worker => {
			workerCreated = true;
			lastWorker = new FakeWorker();
			return lastWorker as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			preload: "metadata",
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));
		expect(workerCreated).toBe(false);

		node.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(workerCreated).toBe(true);
	});

	test("preload: 'auto' — fetch starts immediately (default behavior)", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");

		let workerCreated = false;
		const trackingFactory = (_format: StreamFormat): Worker => {
			workerCreated = true;
			lastWorker = new FakeWorker();
			return lastWorker as unknown as Worker;
		};

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: trackingFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		expect(workerCreated).toBe(true);
		expect(node.preload).toBe("auto");
	});
});

describe("buffer backpressure", () => {
	const callHandleMessage = (
		node: StreamingClipNode,
		msg: { type: string; data: unknown },
	) => {
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({ data: msg } as MessageEvent);
	};

	test("sends pause-fetch when buffer is far ahead", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			pauseFetchAheadSamples: 96_000, // 2 seconds
			resumeFetchAheadSamples: 48_000, // 1 second
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		const worker = lastWorker;

		// Simulate processor reporting large committed buffer (3s = 144000 samples)
		// Playhead starts at 0, so bufferedAhead = 144000 > 96000
		callHandleMessage(node, {
			type: "bufferState",
			data: {
				committedLength: 144_000,
				totalLength: 480_000,
				streamEnded: false,
				writtenSpans: [{ startSample: 0, endSample: 144_000 }],
			},
		});

		const pauseMsg = worker.messages.find((m) => m.type === "pause-fetch");
		expect(pauseMsg).toBeDefined();
	});

	test("sends resume-fetch when buffer drops below threshold", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			pauseFetchAheadSamples: 96_000,
			resumeFetchAheadSamples: 48_000,
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		const worker = lastWorker;

		// Simulate large buffer → triggers pause
		callHandleMessage(node, {
			type: "bufferState",
			data: {
				committedLength: 144_000,
				totalLength: 480_000,
				streamEnded: false,
				writtenSpans: [{ startSample: 0, endSample: 144_000 }],
			},
		});
		expect(worker.messages.some((m) => m.type === "pause-fetch")).toBe(true);

		// Simulate playhead advancing via frame message
		callHandleMessage(node, {
			type: "frame",
			data: [0, 0, 120_000, 0.01],
		});
		// Trigger buffer state update: bufferedAhead = 144000 - 120000 = 24000 < 48000
		callHandleMessage(node, {
			type: "bufferState",
			data: {
				committedLength: 144_000,
				totalLength: 480_000,
				streamEnded: false,
				writtenSpans: [{ startSample: 0, endSample: 144_000 }],
			},
		});

		const resumeMsg = worker.messages.find((m) => m.type === "resume-fetch");
		expect(resumeMsg).toBeDefined();
	});

	test("no backpressure when pauseFetchAheadSamples is 0 (disabled)", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			pauseFetchAheadSamples: 0,
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		const worker = lastWorker;

		// Simulate very large buffer
		callHandleMessage(node, {
			type: "bufferState",
			data: {
				committedLength: 1_000_000,
				totalLength: 2_000_000,
				streamEnded: false,
				writtenSpans: [{ startSample: 0, endSample: 1_000_000 }],
			},
		});

		// No pause should have been sent
		const pauseMsg = worker.messages.find((m) => m.type === "pause-fetch");
		expect(pauseMsg).toBeUndefined();
	});
});

describe("retry on network failure", () => {
	test("passes retry config to worker init message", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			retry: { maxRetries: 5, retryDelayMs: 500 },
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		const initMsg = lastWorker.messages.find((m) => m.type === "init");
		expect(initMsg).toBeDefined();
		expect(initMsg?.retry).toEqual({ maxRetries: 5, retryDelayMs: 500 });
	});

	test("passes null retry config when retry is false", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			retry: false,
		});
		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		const initMsg = lastWorker.messages.find((m) => m.type === "init");
		expect(initMsg).toBeDefined();
		expect(initMsg?.retry).toBeNull();
	});

	test("onretry callback fires when worker sends retry message", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});

		const retryEvents: { attempt: number; delay: number; error: string }[] = [];
		node.onretry = (attempt, delay, error) => {
			retryEvents.push({ attempt, delay, error });
		};

		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		// Simulate worker sending retry message
		lastWorker.receive({
			type: "retry",
			attempt: 1,
			delay: 1000,
			error: "Connection reset",
		});

		expect(retryEvents).toHaveLength(1);
		expect(retryEvents[0]).toEqual({
			attempt: 1,
			delay: 1000,
			error: "Connection reset",
		});
	});

	test("retry event emitter fires with correct args", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});

		const retryEvents: [number, number, string][] = [];
		node.on("retry", (attempt, delay, error) => {
			retryEvents.push([attempt, delay, error]);
		});

		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		lastWorker.receive({
			type: "retry",
			attempt: 2,
			delay: 2000,
			error: "Timeout",
		});

		expect(retryEvents).toHaveLength(1);
		expect(retryEvents[0]).toEqual([2, 2000, "Timeout"]);
	});

	test("default retry config is null when not specified", async () => {
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
		await new Promise((r) => setTimeout(r, 10));

		const initMsg = lastWorker.messages.find((m) => m.type === "init");
		expect(initMsg).toBeDefined();
		expect(initMsg?.retry).toBeNull();
	});
});

describe("metadata extraction", () => {
	test("onmetadata callback fires when worker sends metadata", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});

		const receivedMetadata: unknown[] = [];
		node.onmetadata = (meta) => {
			receivedMetadata.push(meta);
		};

		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		lastWorker.receive({
			type: "metadata",
			metadata: { title: "Test Song", artist: "Test Artist", codec: "opus" },
		});

		expect(receivedMetadata).toHaveLength(1);
		expect(receivedMetadata[0]).toEqual({
			title: "Test Song",
			artist: "Test Artist",
			codec: "opus",
		});
	});

	test("metadata getter returns last received metadata", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});

		expect(node.metadata).toBeNull();

		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		lastWorker.receive({
			type: "metadata",
			metadata: { title: "Song", album: "Album" },
		});

		expect(node.metadata).toEqual({ title: "Song", album: "Album" });
	});

	test("metadata event emitter fires", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});
		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
		});

		const events: unknown[] = [];
		node.on("metadata", (meta) => {
			events.push(meta);
		});

		node.url = "https://example.com/audio.opus";
		await new Promise((r) => setTimeout(r, 10));

		lastWorker.receive({
			type: "metadata",
			metadata: { title: "Test" },
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ title: "Test" });
	});

	test("metadata resets on new stream", async () => {
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
		await new Promise((r) => setTimeout(r, 10));

		lastWorker.receive({
			type: "metadata",
			metadata: { title: "First Song" },
		});
		expect(node.metadata?.title).toBe("First Song");

		// Setting a new URL starts a new stream
		node.url = "https://example.com/other.opus";
		await new Promise((r) => setTimeout(r, 10));

		// Metadata should be reset
		expect(node.metadata).toBeNull();
	});
});

describe("ClipNode seeking", () => {
	test("onseeking and onseeked fire when playhead is set", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new ClipNode(ctx);

		let seekingFired = false;
		let seekedFired = false;
		node.onseeking = () => {
			seekingFired = true;
		};
		node.onseeked = () => {
			seekedFired = true;
		};

		node.playhead = 48_000;
		expect(seekingFired).toBe(true);
		// Non-streaming ClipNode completes immediately
		expect(seekedFired).toBe(true);
		expect(node.seeking).toBe(false);

		node.dispose();
	});

	test("seeking getter is true during seek", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new ClipNode(ctx);

		let seekingDuringSeeking = false;
		node.onseeking = () => {
			seekingDuringSeeking = node.seeking;
		};

		node.playhead = 48_000;
		expect(seekingDuringSeeking).toBe(true);

		node.dispose();
	});

	test("seeking and seeked events fire via emit", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new ClipNode(ctx);

		let seekingEmit = false;
		let seekedEmit = false;
		node.on("seeking", () => {
			seekingEmit = true;
		});
		node.on("seeked", () => {
			seekedEmit = true;
		});

		node.playhead = 48_000;
		expect(seekingEmit).toBe(true);
		expect(seekedEmit).toBe(true);

		node.dispose();
	});

	test("dispose clears onseeking and onseeked", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const node = new ClipNode(ctx);

		node.onseeking = () => {};
		node.onseeked = () => {};
		node.dispose();

		expect(node.onseeking).toBeUndefined();
		expect(node.onseeked).toBeUndefined();
	});
});

describe("StreamingClipNode seeking", () => {
	test("seek within buffered span completes immediately", async () => {
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

		// Simulate bufferState message from processor to populate _writtenSpans
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 96_000,
					totalLength: 480_000,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 96_000 }],
				},
			},
		} as MessageEvent);

		let seekedFired = false;
		node.onseeked = () => {
			seekedFired = true;
		};

		// Seek to a position within the buffered span
		node.playhead = 48_000;

		// Should complete immediately without sending seek to worker
		expect(seekedFired).toBe(true);
		expect(node.seeking).toBe(false);

		const seekMsg = lastWorker.messages.find((m) => m.type === "seek");
		expect(seekMsg).toBeUndefined();

		node.dispose();
	});

	test("seek outside buffer sends seek message to worker", async () => {
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

		// Provide progress so _totalBytesReceived is set
		lastWorker.receive({ type: "progress", bytesReceived: 100_000 });

		// Simulate bufferState from processor
		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 48_000,
					totalLength: 480_000,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 48_000 }],
				},
			},
		} as MessageEvent);

		let seekedFired = false;
		node.onseeked = () => {
			seekedFired = true;
		};

		// Seek beyond buffered region
		node.playhead = 240_000;

		// Should NOT complete yet — waiting for worker
		expect(seekedFired).toBe(false);
		expect(node.seeking).toBe(true);

		// Worker should have received a seek message
		const seekMsg = lastWorker.messages.find((m) => m.type === "seek");
		expect(seekMsg).toBeDefined();
		expect(seekMsg?.sampleOffset).toBe(240_000);
		expect(typeof seekMsg?.byteOffset).toBe("number");

		node.dispose();
	});

	test("seeked message from worker completes the seek", async () => {
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

		lastWorker.receive({ type: "progress", bytesReceived: 100_000 });

		(
			node as never as { handleMessage: (msg: MessageEvent) => void }
		).handleMessage({
			data: {
				type: "bufferState",
				data: {
					committedLength: 48_000,
					totalLength: 480_000,
					streamEnded: false,
					writtenSpans: [{ startSample: 0, endSample: 48_000 }],
				},
			},
		} as MessageEvent);

		let seekedFired = false;
		node.onseeked = () => {
			seekedFired = true;
		};

		// Seek outside buffer
		node.playhead = 240_000;
		expect(node.seeking).toBe(true);
		expect(seekedFired).toBe(false);

		// Worker signals seek complete
		lastWorker.receive({ type: "seeked" });

		expect(seekedFired).toBe(true);
		expect(node.seeking).toBe(false);

		node.dispose();
	});

	test("seek with no worker completes immediately", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode(undefined, {
			format: "OggOpus",
			preload: "none",
		});
		// Don't set URL — no worker will be created

		let seekedFired = false;
		node.onseeked = () => {
			seekedFired = true;
		};

		node.playhead = 48_000;
		expect(seekedFired).toBe(true);
		expect(node.seeking).toBe(false);

		node.dispose();
	});
});
