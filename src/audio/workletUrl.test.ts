import { describe, expect, test } from "bun:test";
import { getProcessorModuleUrl } from "./workletUrl";

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
