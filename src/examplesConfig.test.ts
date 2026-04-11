import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("examples config", () => {
	test("uses the local dist build in bundled examples", async () => {
		const reactSource = await readFile(
			join(import.meta.dir, "../examples/react/src/App.tsx"),
			"utf8",
		);
		const esmSource = await readFile(
			join(import.meta.dir, "../examples/esm-bundler/main.ts"),
			"utf8",
		);
		const selfHostedSource = await readFile(
			join(import.meta.dir, "../examples/self-hosted/src/main.ts"),
			"utf8",
		);

		expect(reactSource).toContain("@jadujoel/web-audio-clip-node/react");
		expect(reactSource).toContain("@jadujoel/web-audio-clip-node/styles.css");
		expect(esmSource).toContain("@jadujoel/web-audio-clip-node");
		expect(selfHostedSource).toContain("@jadujoel/web-audio-clip-node");
	});

	test("rebuilds the local library before serving examples", async () => {
		const source = await readFile(
			join(import.meta.dir, "../examples.ts"),
			"utf8",
		);

		expect(source).toContain("bun run build:lib");
		expect(source).toContain('linkWorkspacePackage("examples/react")');
		expect(source).toContain('linkWorkspacePackage("examples/esm-bundler")');
		expect(source).toContain('linkWorkspacePackage("examples/self-hosted")');
		expect(source).toContain("bun run --cwd examples/self-hosted setup");
	});
});
