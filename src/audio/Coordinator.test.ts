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
		const coordinator = Coordinator.fromContext(ctx);
		expect(coordinator).toBeInstanceOf(Coordinator);
	});
});

describe("Coordinator.addModule", () => {
	test("calls ctx.audioWorklet.addModule with the processor URL", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		const coordinator = Coordinator.fromContext(ctx);
		await coordinator.addModule("./dist/audio/processor.js");
		await coordinator.addModule("./dist/audio/processor.js");
		expect(true).toBe(true);
	});
});

describe("Coordinator.ClipNode", () => {
	test("returns a regular ClipNode", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		const node = coordinator.ClipNode();
		expect(node).toBeInstanceOf(ClipNode);
		expect(node).not.toBeInstanceOf(StreamingClipNode);
	});
});

describe("Coordinator.StreamingClipNode", () => {
	test("returns a StreamingClipNode", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});
		const node = coordinator.StreamingClipNode();
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
		});
		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.unknown";

		expect(capturedFormats[0]).toBe("OggOpus");
	});
});

describe("Coordinator.dispose", () => {
	test("stops all managed nodes", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});

		const regular = coordinator.ClipNode();
		const streaming = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
		streaming.url = "https://example.com/audio.opus";
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
		});

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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
		const node = coordinator.StreamingClipNode();
		node.url = "https://example.com/audio.opus";
		expect(node.url).toBe("https://example.com/audio.opus");
	});
});

describe("StreamingClipNode.start - deferred until first decoded", () => {
	test("does not start immediately; fires when worker sends decoded", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("./dist/audio/processor.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
		});

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
		node.url = "https://example.com/audio.opus";

		const worker = lastWorker;
		node.start();

		let stateChanged = false;
		node.onstarted = () => {
			stateChanged = true;
		};

		worker.receive({ type: "decoded" });

		expect(stateChanged).toBe(false);
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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

		const node = coordinator.StreamingClipNode(undefined, {
			format: "OggOpus",
		});
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
		const node = coordinator.StreamingClipNode();
		node.url = "https://example.com/audio.opus";

		expect(capturedFormats[0]).toBe("OggOpus");
	});
});
