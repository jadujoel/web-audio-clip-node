import { describe, expect, test } from "bun:test";

describe("test runner resource safeguards", () => {
	test("package test scripts use vitest", async () => {
		const packageJson = (await Bun.file("package.json").json()) as {
			scripts?: Record<string, string>;
		};

		expect(packageJson.scripts?.test).toContain("vitest");
		expect(packageJson.scripts?.validate).toContain("test:all");
	});

	test("publish workflow uses test script", async () => {
		const workflow = await Bun.file(".github/workflows/publish.yml").text();
		expect(workflow).toContain("run: bun run test");
	});
});
