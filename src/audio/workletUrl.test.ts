import { describe, expect, test } from "vitest";
import {
	getProcessorBlobUrl,
	getProcessorCdnUrl,
	getProcessorModuleUrl,
} from "./workletUrl";

describe("getProcessorModuleUrl", () => {
	test("resolves relative to the site root in local development", () => {
		expect(getProcessorModuleUrl("http://localhost:3000/")).toBe(
			"http://localhost:3000/processor.js",
		);
	});

	test("resolves relative to the repository base path on GitHub Pages", () => {
		expect(getProcessorModuleUrl("https://jadujoel.github.io/clip/")).toBe(
			"https://jadujoel.github.io/clip/processor.js",
		);
	});

	test("resolves correctly when the base URL points at index.html", () => {
		expect(
			getProcessorModuleUrl("https://jadujoel.github.io/clip/index.html"),
		).toBe("https://jadujoel.github.io/clip/processor.js");
	});
});

describe("getProcessorBlobUrl", () => {
	test("returns a blob: URL", () => {
		const url = getProcessorBlobUrl();
		expect(url.startsWith("blob:")).toBe(true);
	});
});

describe("getProcessorCdnUrl", () => {
	test("returns a jsdelivr URL with the given version", () => {
		const url = getProcessorCdnUrl("latest");
		expect(url).toBe(
			"https://cdn.jsdelivr.net/npm/@jadujoel/web-audio-clip-node@latest/dist/processor.js",
		);
	});

	test("uses a default version when none is provided", () => {
		const url = getProcessorCdnUrl();
		expect(url).toContain("@jadujoel/web-audio-clip-node@");
		expect(url.endsWith("/dist/processor.js")).toBe(true);
	});
});
