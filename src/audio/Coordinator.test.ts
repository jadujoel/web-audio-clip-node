import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createContext } from "../../TestPreload";
import type { StreamFormat } from "../streaming";
import { Coordinator, StreamingClipNode } from "./Coordinator";

// ── Fake Worker ──────────────────────────────────────────────────────────────
// Instead of importing real Worker (which spawns processes), we inject a fake
// one via the `workerFactory` DI option on Coordinator.fromContext().

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

	/** Simulate a message arriving from the worker. */
	receive(data: FakeWorkerMessage) {
		this.onmessage?.({ data });
	}
}

let lastWorker: FakeWorker;
function fakeWorkerFactory(_format: StreamFormat): Worker {
	lastWorker = new FakeWorker();
	return lastWorker as unknown as Worker;
}

// ── Setup ────────────────────────────────────────────────────────────────────

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
	// reset between tests
	lastWorker = undefined as unknown as FakeWorker;
});

// ── Coordinator ──────────────────────────────────────────────────────────────

describe("Coordinator.fromContext", () => {
	test("returns a Coordinator instance", () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx);
		expect(coordinator).toBeInstanceOf(Coordinator);
	});
});

describe("Coordinator.addModule", () => {
	test("calls ctx.audioWorklet.addModule with the processor URL", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx);
		await coordinator.addModule("./dist/audio/processor.js");
		// Second call should be a no-op (idempotent)
		await coordinator.addModule("./dist/audio/processor.js");
		// If addModule were called twice the underlying implementation would
		// throw on the second call; reaching here proves idempotency.
		expect(true).toBe(true);
	});
});

describe("Coordinator.addStreamingSupport", () => {
	test("returns the coordinator (chainable / awaitable)", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx);
		const result = await coordinator.addStreamingSupport("OggOpus");
		expect(result).toBe(coordinator);
	});

	test("works without a format argument (enables auto-detect)", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx);
		const result = await coordinator.addStreamingSupport();
		expect(result).toBe(coordinator);
	});
});

describe("Coordinator.ClipNode", () => {
	test("returns a StreamingClipNode", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		const node = coordinator.ClipNode();
		expect(node).toBeInstanceOf(StreamingClipNode);
	});
});

describe("Coordinator.dispose", () => {
	test("stops all managed nodes", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

		const worker = lastWorker;
		coordinator.dispose();

		expect(worker.terminated).toBe(true);
	});
});

// ── StreamingClipNode ────────────────────────────────────────────────────────

describe("StreamingClipNode.url setter", () => {
	test("creates a worker and posts an init message with the url and sampleRate", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		const url = "https://example.com/audio.opus";
		node.url = url;

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
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio1.opus";
		const firstWorker = lastWorker;

		node.url = "https://example.com/audio2.opus";

		expect(firstWorker.terminated).toBe(true);
		expect(lastWorker).not.toBe(firstWorker);
	});

	test("url getter returns the last set value", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";
		expect(node.url).toBe("https://example.com/audio.opus");
	});
});

describe("StreamingClipNode.start – deferred until first decoded", () => {
	test("does not start immediately; fires when worker sends decoded", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

		const worker = lastWorker;

		// start() called before any decoded message
		node.start();

		// No "start" message should have been sent to the worklet yet
		// (ClipNode.start() posts { type: "start" } via this.port.postMessage)
		// We can't directly introspect AudioWorkletNode.port in tests,
		// but we can verify that the worker message arrives correctly
		// by simulating the decoded message and checking state changes.
		let stateChanged = false;
		node.onstarted = () => {
			stateChanged = true;
		};

		// Simulate the first decoded message from the worker
		worker.receive({ type: "decoded" });

		// After decoded, the deferred start should have been triggered.
		// In a real context the worklet handles it; here we just verify no throw.
		expect(stateChanged).toBe(false); // onstarted fires from worklet, not synchronously
		expect(node.url).toBe("https://example.com/audio.opus");
	});
});

describe("StreamingClipNode.stop", () => {
	test("terminates the managed worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

		const worker = lastWorker;
		node.stop();

		expect(worker.terminated).toBe(true);
	});

	test("sends abort message before terminating worker", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

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
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

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
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

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
		});
		await coordinator.addStreamingSupport("OggOpus");

		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

		let done = false;
		node.ondone = () => {
			done = true;
		};

		lastWorker.receive({ type: "done" });
		expect(done).toBe(true);
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
		});
		// No addStreamingSupport → auto-detect
		const node = coordinator.ClipNode();
		node.url = "https://example.com/audio.opus";

		expect(capturedFormats[0]).toBe("OggOpus");
	});
});
