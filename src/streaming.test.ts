import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("streaming build output", () => {
	const workerFiles = [
		"mp3-decode-worker.min.js",
		"ogg-opus-decode-worker.min.js",
		"raw-opus-framed-decode-worker.min.js",
		"webm-opus-decode-worker.min.js",
	];

	for (const file of workerFiles) {
		test(`dist/workers/${file} exists after build`, () => {
			expect(existsSync(join("dist", "workers", file))).toBe(true);
		});
	}

	test("dist/streaming.js exists after build", () => {
		expect(existsSync("dist/streaming.js")).toBe(true);
	});

	test("dist/streaming.d.ts exists after build", () => {
		expect(existsSync("dist/streaming.d.ts")).toBe(true);
	});
});
