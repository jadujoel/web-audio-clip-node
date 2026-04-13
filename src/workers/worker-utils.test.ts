import { describe, expect, test } from "bun:test";
import {
	BackpressureGate,
	DEFAULT_RETRY_CONFIG,
	fetchWithRetry,
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
