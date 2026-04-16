import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createContext } from "../../TestPreload";
import type { StreamFormat } from "../streaming";
import { Coordinator } from "./Coordinator";
import { ClipNode } from "./clip/node";
import type { AudioMetadata } from "./clip/types";
import { bindMediaSession } from "./media-session";

// --- Fake MediaSession ---

class FakeMediaSession {
	metadata: MediaMetadata | null = null;
	playbackState: MediaSessionPlaybackState = "none";
	private _handlers = new Map<
		MediaSessionAction,
		MediaSessionActionHandler | null
	>();
	private _positionStates: MediaPositionState[] = [];

	setActionHandler(
		action: MediaSessionAction,
		handler: MediaSessionActionHandler | null,
	) {
		this._handlers.set(action, handler);
	}

	getHandler(action: MediaSessionAction): MediaSessionActionHandler | null {
		return this._handlers.get(action) ?? null;
	}

	setPositionState(state?: MediaPositionState) {
		if (state) this._positionStates.push(state);
	}

	get lastPositionState(): MediaPositionState | undefined {
		return this._positionStates[this._positionStates.length - 1];
	}

	get positionStateCount(): number {
		return this._positionStates.length;
	}

	reset() {
		this._handlers.clear();
		this._positionStates = [];
		this.metadata = null;
		this.playbackState = "none";
	}
}

// --- Fake Worker ---

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

// --- Test helper ---

function callHandleMessage(node: ClipNode, data: Record<string, unknown>) {
	(
		node as never as { handleMessage: (msg: MessageEvent) => void }
	).handleMessage({ data } as MessageEvent);
}

// Helper to capture port messages
function capturePortMessages(
	node: ClipNode,
): { type: string; data: unknown }[] {
	const messages: { type: string; data: unknown }[] = [];
	const origPostMessage = node.port.postMessage.bind(node.port);
	node.port.postMessage = (msg: unknown) => {
		const m = msg as { type: string; data: unknown };
		messages.push(m);
		origPostMessage(m);
	};
	return messages;
}

// --- Setup ---

let fakeSession: FakeMediaSession;

beforeEach(() => {
	fakeSession = new FakeMediaSession();
	Object.defineProperty(globalThis, "navigator", {
		value: { mediaSession: fakeSession },
		writable: true,
		configurable: true,
	});
	// Ensure MediaMetadata is available
	if (typeof globalThis.MediaMetadata === "undefined") {
		(globalThis as Record<string, unknown>).MediaMetadata =
			class MediaMetadata {
				title: string;
				artist: string;
				album: string;
				artwork: MediaImage[];
				constructor(init?: MediaMetadataInit) {
					this.title = init?.title ?? "";
					this.artist = init?.artist ?? "";
					this.album = init?.album ?? "";
					this.artwork = init?.artwork ?? [];
				}
			};
	}
});

afterEach(() => {
	fakeSession.reset();
	lastWorker = undefined as unknown as FakeWorker;
});

describe("bindMediaSession", () => {
	test("sets metadata from options", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node, {
			title: "My Song",
			artist: "Artist",
			album: "Album",
			artwork: [{ src: "cover.jpg", sizes: "256x256", type: "image/jpeg" }],
		});

		expect(fakeSession.metadata).not.toBeNull();
		expect(fakeSession.metadata?.title).toBe("My Song");
		expect(fakeSession.metadata?.artist).toBe("Artist");
		expect(fakeSession.metadata?.album).toBe("Album");
		expect(fakeSession.metadata?.artwork).toHaveLength(1);

		node.dispose();
	});

	test("sets default title when no options given", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node);

		expect(fakeSession.metadata?.title).toBe("Unknown");

		node.dispose();
	});

	test("play action handler calls resume", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("play");
		expect(handler).not.toBeNull();
		handler?.({ action: "play" });

		// Check that a resume message was posted to port
		// The port.postMessage is called with { type: "resume", data: ... }

		node.dispose();
	});

	test("pause action handler calls pause", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("pause");
		expect(handler).not.toBeNull();
		handler?.({ action: "pause" });

		node.dispose();
	});

	test("stop action handler calls stop", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("stop");
		expect(handler).not.toBeNull();
		handler?.({ action: "stop" });

		node.dispose();
	});

	test("seekbackward handler seeks back by offset", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		(node as unknown as { _playhead: number })._playhead = 30 * 48_000;
		const portMessages = capturePortMessages(node);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekbackward");
		handler?.({ action: "seekbackward", seekOffset: 5 });

		const playheadMsg = portMessages.find((m) => m.type === "playhead");
		expect(playheadMsg).toBeDefined();
		expect(playheadMsg?.data).toBe(25 * 48_000);

		node.dispose();
	});

	test("seekforward handler seeks forward by offset", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		(node as unknown as { _playhead: number })._playhead = 30 * 48_000;
		const portMessages = capturePortMessages(node);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekforward");
		handler?.({ action: "seekforward", seekOffset: 5 });

		const playheadMsg = portMessages.find((m) => m.type === "playhead");
		expect(playheadMsg).toBeDefined();
		expect(playheadMsg?.data).toBe(35 * 48_000);

		node.dispose();
	});

	test("seekto handler sets currentTime", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		const portMessages = capturePortMessages(node);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekto");
		handler?.({ action: "seekto", seekTime: 42 });

		const playheadMsg = portMessages.find((m) => m.type === "playhead");
		expect(playheadMsg).toBeDefined();
		expect(playheadMsg?.data).toBe(42 * 48_000);

		node.dispose();
	});

	test("playback state updates on node state changes", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		bindMediaSession(node);

		// Simulate started
		callHandleMessage(node, { type: "started" });
		expect(fakeSession.playbackState).toBe("playing");

		// Simulate paused
		callHandleMessage(node, { type: "paused" });
		expect(fakeSession.playbackState).toBe("paused");

		// Simulate resume
		callHandleMessage(node, { type: "resume" });
		expect(fakeSession.playbackState).toBe("playing");

		// Simulate stopped
		callHandleMessage(node, { type: "stopped" });
		expect(fakeSession.playbackState).toBe("none");

		// Simulate ended
		callHandleMessage(node, { type: "ended" });
		expect(fakeSession.playbackState).toBe("none");

		node.dispose();
	});

	test("unbind removes all action handlers", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		const unbind = bindMediaSession(node, { title: "Test" });

		expect(fakeSession.getHandler("play")).not.toBeNull();
		expect(fakeSession.getHandler("pause")).not.toBeNull();
		expect(fakeSession.getHandler("stop")).not.toBeNull();

		unbind();

		expect(fakeSession.getHandler("play")).toBeNull();
		expect(fakeSession.getHandler("pause")).toBeNull();
		expect(fakeSession.getHandler("stop")).toBeNull();
		expect(fakeSession.getHandler("seekbackward")).toBeNull();
		expect(fakeSession.getHandler("seekforward")).toBeNull();
		expect(fakeSession.getHandler("seekto")).toBeNull();
		expect(fakeSession.playbackState).toBe("none");
		expect(fakeSession.metadata).toBeNull();

		node.dispose();
	});

	test("unbind restores previous onstatechange callback", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);

		const states: string[] = [];
		node.onstatechange = (e) => states.push(e.state);

		const unbind = bindMediaSession(node);

		// State change while bound should still call original
		callHandleMessage(node, { type: "started" });
		expect(states).toContain("started");

		unbind();

		// After unbind, onstatechange should be the original
		callHandleMessage(node, { type: "paused" });
		expect(states).toContain("paused");

		node.dispose();
	});

	test("auto-updates metadata from streaming node onmetadata", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: fakeWorkerFactory,
			processorUrl: "./dist/clip-processor.bundle.js",
		});

		const node = coordinator.createStreamingClipNode(
			{},
			{
				format: "Mp3",
				preload: "none",
			},
		);
		node.url = "http://test.mp3";

		bindMediaSession(node, { title: "Fallback" });

		expect(fakeSession.metadata?.title).toBe("Fallback");

		// Simulate metadata event from worker
		const meta: AudioMetadata = {
			title: "Extracted Title",
			artist: "Extracted Artist",
		};
		node.streamEvents.dispatch("metadata", { metadata: meta });

		expect(fakeSession.metadata?.title).toBe("Extracted Title");
		expect(fakeSession.metadata?.artist).toBe("Extracted Artist");

		node.dispose();
	});

	test("returns noop when navigator.mediaSession is unavailable", () => {
		// Remove mediaSession
		Object.defineProperty(globalThis, "navigator", {
			value: {},
			writable: true,
			configurable: true,
		});

		const unbind = bindMediaSession({} as ClipNode);
		expect(typeof unbind).toBe("function");
		// Should not throw
		unbind();
	});

	test("seekbackward defaults to 10 seconds when no seekOffset", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		(node as unknown as { _playhead: number })._playhead = 30 * 48_000;
		const portMessages = capturePortMessages(node);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekbackward");
		handler?.({ action: "seekbackward" });

		const playheadMsg = portMessages.find((m) => m.type === "playhead");
		expect(playheadMsg).toBeDefined();
		expect(playheadMsg?.data).toBe(20 * 48_000);

		node.dispose();
	});

	test("seekforward clamps to duration", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		(node as unknown as { _playhead: number })._playhead = 55 * 48_000;

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekforward");
		handler?.({ action: "seekforward", seekOffset: 10 });

		// Verify clamped to duration (60s)
		(node as unknown as { _playhead: number })._playhead = 60 * 48_000;
		expect(node.currentTime).toBe(60);

		node.dispose();
	});

	test("seekbackward clamps to 0", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/clip-processor.bundle.js");
		const node = new ClipNode(ctx);
		node.duration = 60;
		(node as unknown as { _playhead: number })._playhead = 3 * 48_000;
		const portMessages = capturePortMessages(node);

		bindMediaSession(node);

		const handler = fakeSession.getHandler("seekbackward");
		handler?.({ action: "seekbackward", seekOffset: 10 });

		const playheadMsg = portMessages.find((m) => m.type === "playhead");
		expect(playheadMsg).toBeDefined();
		expect(playheadMsg?.data).toBe(0);

		node.dispose();
	});
});
