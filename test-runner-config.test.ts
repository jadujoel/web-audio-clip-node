import { describe, expect, test } from "bun:test";

describe("test runner resource safeguards", () => {
	test("package test scripts cap bun concurrency", async () => {
		const packageJson = (await Bun.file("package.json").json()) as {
			scripts?: Record<string, string>;
		};

		expect(packageJson.scripts?.test).toContain("--max-concurrency=4");
		expect(packageJson.scripts?.validate).toContain("--max-concurrency=4");
	});

	test("bunfig disables coverage for default test runs", async () => {
		const bunfig = await Bun.file("bunfig.toml").text();
		expect(bunfig).toContain("coverage = false");
	});

	test("publish workflow uses throttled test script", async () => {
		const workflow = await Bun.file(".github/workflows/publish.yml").text();
		expect(workflow).toContain("run: bun run test");
	});
});
