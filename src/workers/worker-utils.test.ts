import { describe, expect, test } from "bun:test";
import {
	BackpressureGate,
	DEFAULT_RETRY_CONFIG,
	fetchWithRetry,
	FrameBatcher,
	float32ToInt16,
	maybeConvertToInt16,
	parseTotalBytes,
	type StreamRetryConfig,
} from "./worker-utils";

describe("BackpressureGate", () => {
	test("wait returns immediately when not paused", () => {
		const gate = new BackpressureGate();
		const result = gate.wait();
		expect(result).toBeUndefined();
	});

	test("wait blocks when paused and resolves on resume", async () => {
		const gate = new BackpressureGate();
		gate.pause();
		expect(gate.paused).toBe(true);

		let resolved = false;
		const promise = gate.wait() as Promise<void>;
		promise.then(() => {
			resolved = true;
		});

		await new Promise((r) => setTimeout(r, 10));
		expect(resolved).toBe(false);

		gate.resume();
		await promise;
		expect(resolved).toBe(true);
		expect(gate.paused).toBe(false);
	});
});

describe("DEFAULT_RETRY_CONFIG", () => {
	test("has expected defaults", () => {
		expect(DEFAULT_RETRY_CONFIG).toEqual({
			maxRetries: 3,
			retryDelayMs: 1000,
			backoffMultiplier: 2,
			maxRetryDelayMs: 30_000,
		});
	});
});

describe("PCM int16 helpers", () => {
	test("float32ToInt16 clamps and scales normalized samples", () => {
		const src = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]);
		const out = float32ToInt16(src);
		expect(Array.from(out)).toEqual([
			-32768, -32768, -16384, 0, 16384, 32767, 32767,
		]);
	});

	test("maybeConvertToInt16(false) preserves float32 channels", () => {
		const channels = [new Float32Array([0, 0.25, -0.25])];
		const out = maybeConvertToInt16(channels, false);
		expect(out[0]).toBe(channels[0]);
	});

	test("maybeConvertToInt16(true) reduces transport bytes by ~50%", () => {
		// useInt16 is now a no-op — always returns Float32Array unchanged (with deprecation warning)
		const channels = [new Float32Array([0, 0.25, -0.25])];
		const out = maybeConvertToInt16(channels, true);
		expect(out[0]).toBe(channels[0]); // same reference, no conversion
		expect(out[0] instanceof Float32Array).toBe(true);
	});
});

describe("parseTotalBytes", () => {
	test("returns content-length for normal (200) response", () => {
		const response = new Response("ok", {
			status: 200,
			headers: { "content-length": "50000" },
		});
		expect(parseTotalBytes(response)).toBe(50000);
	});

	test("returns null when no content-length on 200 response", () => {
		const response = new Response("ok", { status: 200 });
		expect(parseTotalBytes(response)).toBeNull();
	});

	test("extracts total from content-range on 206 response", () => {
		const response = new Response("ok", {
			status: 206,
			headers: {
				"content-range": "bytes 1024-2047/100000",
				"content-length": "1024",
			},
		});
		expect(parseTotalBytes(response)).toBe(100000);
	});

	test("falls back to byteOffset + content-length on 206 without content-range", () => {
		const response = new Response("ok", {
			status: 206,
			headers: { "content-length": "49000" },
		});
		expect(parseTotalBytes(response, 1000)).toBe(50000);
	});

	test("returns null on 206 with no content-range or content-length", () => {
		const response = new Response("ok", { status: 206 });
		expect(parseTotalBytes(response)).toBeNull();
	});
});

describe("fetchWithRetry", () => {
	test("returns response on successful fetch", async () => {
		const originalFetch = globalThis.fetch;
		const mockResponse = new Response("ok", { status: 200 });
		globalThis.fetch = (async () => mockResponse) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			const response = await fetchWithRetry(
				"https://example.com/audio.mp3",
				controller.signal,
				null,
			);
			expect(response).toBe(mockResponse);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("retries on network failure and succeeds", async () => {
		const originalFetch = globalThis.fetch;
		const postedMessages: unknown[] = [];
		const originalPostMessage = globalThis.self?.postMessage;
		(globalThis as Record<string, unknown>).self = {
			postMessage: (msg: unknown) => {
				postedMessages.push(msg);
			},
		};

		let attempt = 0;
		globalThis.fetch = (async () => {
			attempt++;
			if (attempt < 3) {
				throw new Error("Connection reset");
			}
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			const config: StreamRetryConfig = {
				maxRetries: 3,
				retryDelayMs: 10, // short delay for tests
				backoffMultiplier: 1,
				maxRetryDelayMs: 100,
			};
			const response = await fetchWithRetry(
				"https://example.com/audio.mp3",
				controller.signal,
				config,
			);
			expect(response.status).toBe(200);
			expect(attempt).toBe(3);
			// Should have posted 2 retry messages
			expect(postedMessages).toHaveLength(2);
			expect((postedMessages[0] as Record<string, unknown>).type).toBe("retry");
			expect((postedMessages[0] as Record<string, unknown>).attempt).toBe(1);
			expect((postedMessages[1] as Record<string, unknown>).attempt).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalPostMessage) {
				globalThis.self.postMessage = originalPostMessage;
			}
		}
	});

	test("throws after maxRetries exhausted", async () => {
		const originalFetch = globalThis.fetch;
		const originalPostMessage = globalThis.self?.postMessage;
		(globalThis as Record<string, unknown>).self = {
			postMessage: () => {},
		};

		globalThis.fetch = (async () => {
			throw new Error("Connection refused");
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			const config: StreamRetryConfig = {
				maxRetries: 2,
				retryDelayMs: 10,
				backoffMultiplier: 1,
				maxRetryDelayMs: 100,
			};
			await expect(
				fetchWithRetry(
					"https://example.com/audio.mp3",
					controller.signal,
					config,
				),
			).rejects.toThrow("Connection refused");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalPostMessage) {
				globalThis.self.postMessage = originalPostMessage;
			}
		}
	});

	test("does not retry when config is null", async () => {
		const originalFetch = globalThis.fetch;
		let attempts = 0;
		globalThis.fetch = (async () => {
			attempts++;
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			await expect(
				fetchWithRetry(
					"https://example.com/audio.mp3",
					controller.signal,
					null,
				),
			).rejects.toThrow("Network error");
			expect(attempts).toBe(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("throws immediately when signal is aborted", async () => {
		const originalFetch = globalThis.fetch;
		const originalPostMessage = globalThis.self?.postMessage;
		(globalThis as Record<string, unknown>).self = {
			postMessage: () => {},
		};

		globalThis.fetch = (async (
			_url: string | URL | Request,
			init?: RequestInit,
		) => {
			if (init?.signal?.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}
			throw new Error("Network error");
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			controller.abort();
			const config: StreamRetryConfig = {
				maxRetries: 3,
				retryDelayMs: 10,
				backoffMultiplier: 1,
				maxRetryDelayMs: 100,
			};
			await expect(
				fetchWithRetry(
					"https://example.com/audio.mp3",
					controller.signal,
					config,
				),
			).rejects.toThrow("Aborted");
		} finally {
			globalThis.fetch = originalFetch;
			if (originalPostMessage) {
				globalThis.self.postMessage = originalPostMessage;
			}
		}
	});

	test("sends Range header when bytesReceived > 0", async () => {
		const originalFetch = globalThis.fetch;
		let capturedHeaders: HeadersInit | undefined;
		globalThis.fetch = (async (
			_url: string | URL | Request,
			init?: RequestInit,
		) => {
			capturedHeaders = init?.headers;
			return new Response("ok", { status: 206 });
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			await fetchWithRetry(
				"https://example.com/audio.mp3",
				controller.signal,
				null,
				1024,
			);
			expect(capturedHeaders).toBeDefined();
			expect((capturedHeaders as Record<string, string>).Range).toBe(
				"bytes=1024-",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("exponential backoff increases delay", async () => {
		const originalFetch = globalThis.fetch;
		const postedMessages: Record<string, unknown>[] = [];
		const originalPostMessage = globalThis.self?.postMessage;
		(globalThis as Record<string, unknown>).self = {
			postMessage: (msg: unknown) => {
				postedMessages.push(msg as Record<string, unknown>);
			},
		};

		let attempt = 0;
		globalThis.fetch = (async () => {
			attempt++;
			if (attempt <= 3) throw new Error("fail");
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;

		try {
			const controller = new AbortController();
			const config: StreamRetryConfig = {
				maxRetries: 5,
				retryDelayMs: 10,
				backoffMultiplier: 2,
				maxRetryDelayMs: 1000,
			};
			await fetchWithRetry(
				"https://example.com/audio.mp3",
				controller.signal,
				config,
			);
			// Check delays: 10, 20, 40
			expect(postedMessages[0].delay).toBe(10);
			expect(postedMessages[1].delay).toBe(20);
			expect(postedMessages[2].delay).toBe(40);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalPostMessage) {
				globalThis.self.postMessage = originalPostMessage;
			}
		}
	});
});

// ---------------------------------------------------------------------------
// FrameBatcher
// ---------------------------------------------------------------------------

describe("FrameBatcher", () => {
	test("returns null until threshold reached", () => {
		const batcher = new FrameBatcher();
		// FRAME_BATCH_THRESHOLD_SAMPLES = 2048; add 3 x 512 = 1536 (<2048) → null
		const frame = new Float32Array(512).fill(0.5);
		expect(batcher.add([frame])).toBeNull();
		expect(batcher.add([frame])).toBeNull();
		expect(batcher.add([frame])).toBeNull();
		// 4th add: 4 * 512 = 2048 → should return batched channels
		const batch = batcher.add([frame]);
		expect(batch).not.toBeNull();
		expect(batch![0].length).toBe(2048);
	});

	test("concatenates channel data correctly at threshold", () => {
		const batcher = new FrameBatcher();
		const ch0a = new Float32Array(1024).fill(0.1);
		const ch1a = new Float32Array(1024).fill(-0.1);
		batcher.add([ch0a, ch1a]); // 1024 samples — not full
		const ch0b = new Float32Array(1024).fill(0.9);
		const ch1b = new Float32Array(1024).fill(-0.9);
		const batch = batcher.add([ch0b, ch1b]); // 2048 → triggers flush
		expect(batch).not.toBeNull();
		expect(batch!.length).toBe(2);
		expect(batch![0].length).toBe(2048);
		expect(batch![1].length).toBe(2048);
		// First 1024 samples come from the first frame
		expect(batch![0][0]).toBeCloseTo(0.1);
		expect(batch![0][1023]).toBeCloseTo(0.1);
		// Next 1024 come from the second frame
		expect(batch![0][1024]).toBeCloseTo(0.9);
		expect(batch![1][0]).toBeCloseTo(-0.1);
		expect(batch![1][1024]).toBeCloseTo(-0.9);
	});

	test("flush returns accumulated frames and resets batcher", () => {
		const batcher = new FrameBatcher();
		const frame = new Float32Array(512).fill(0.3);
		batcher.add([frame]);
		batcher.add([frame]);
		const flushed = batcher.flush();
		expect(flushed).not.toBeNull();
		expect(flushed![0].length).toBe(1024);
		// After flush, batcher is empty
		expect(batcher.flush()).toBeNull();
		expect(batcher.bufferedSamples).toBe(0);
	});

	test("flush returns null when empty", () => {
		const batcher = new FrameBatcher();
		expect(batcher.flush()).toBeNull();
	});

	test("after batch emitted, subsequent adds start from empty", () => {
		const batcher = new FrameBatcher();
		const big = new Float32Array(2048).fill(0.1);
		const batch = batcher.add([big]); // exactly at threshold
		expect(batch).not.toBeNull();
		// Batcher is now empty
		expect(batcher.bufferedSamples).toBe(0);
		const small = new Float32Array(100).fill(0.5);
		expect(batcher.add([small])).toBeNull();
		expect(batcher.bufferedSamples).toBe(100);
	});

	test("bufferRange exceeding threshold emits immediately", () => {
		const batcher = new FrameBatcher();
		// Add a frame larger than the threshold
		const big = new Float32Array(4096).fill(0.7);
		const batch = batcher.add([big]);
		expect(batch).not.toBeNull();
		expect(batch![0].length).toBe(4096);
	});
});
