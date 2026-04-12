import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("examples config", () => {
	test("uses the local dist build in bundled examples", async () => {
		const playgroundSource = await readFile(
			join(import.meta.dir, "../examples/playground/src/App.tsx"),
			"utf8",
		);
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
		const streamingSource = await readFile(
			join(import.meta.dir, "../examples/streaming/src/App.tsx"),
			"utf8",
		);
		const streamingHookSource = await readFile(
			join(
				import.meta.dir,
				"../examples/streaming/src/useStreamingClipNode.ts",
			),
			"utf8",
		);
		const streamingShimSource = await readFile(
			join(import.meta.dir, "../examples/streaming/src/clip-node-lib.ts"),
			"utf8",
		);

		expect(playgroundSource).toContain("@jadujoel/web-audio-clip-node");
		expect(playgroundSource).toContain("@jadujoel/web-audio-clip-node/react");
		expect(playgroundSource).toContain(
			"@jadujoel/web-audio-clip-node/styles.css",
		);
		expect(reactSource).toContain("@jadujoel/web-audio-clip-node/react");
		expect(reactSource).toContain("@jadujoel/web-audio-clip-node/styles.css");
		expect(esmSource).toContain("@jadujoel/web-audio-clip-node");
		expect(selfHostedSource).toContain("@jadujoel/web-audio-clip-node");
		expect(streamingSource).not.toContain("@jadujoel/web-audio-clip-node");
		expect(streamingHookSource).not.toContain("@jadujoel/web-audio-clip-node");
		expect(streamingShimSource).toContain("../../../src/lib");
		expect(streamingShimSource).toContain("../../../src/lib-react");
		expect(streamingShimSource).toContain("../../../src/streaming");
	});

	test("rebuilds the local library before serving examples", async () => {
		const source = await readFile(
			join(import.meta.dir, "../examples.ts"),
			"utf8",
		);

		expect(source).toContain("bun run build:lib");
		expect(source).toContain('linkWorkspacePackage("examples/playground")');
		expect(source).toContain('linkWorkspacePackage("examples/react")');
		expect(source).toContain('linkWorkspacePackage("examples/esm-bundler")');
		expect(source).toContain('linkWorkspacePackage("examples/self-hosted")');
		expect(source).not.toContain('linkWorkspacePackage("examples/streaming")');
		expect(source).toContain("bun run --cwd examples/self-hosted setup");
		expect(source).toContain(
			"npm install --prefix examples/streaming --no-package-lock --no-save ts-ebml@3.0.2",
		);
	});
});
