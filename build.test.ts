import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	addJsExtensionsToRelativeImports,
	createAppBuildConfig,
} from "./build";

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
});

describe("app build", () => {
	test("adds .js extensions to emitted relative imports", () => {
		const source = [
			'import { foo } from "./foo";',
			'export { bar } from "../bar";',
			'const mod = import("./baz");',
			'import "./keep.css";',
		].join("\n");

		expect(addJsExtensionsToRelativeImports(source)).toBe(
			[
				'import { foo } from "./foo.js";',
				'export { bar } from "../bar.js";',
				'const mod = import("./baz.js");',
				'import "./keep.css";',
			].join("\n"),
		);
	});

	test("emits the React production bundle", async () => {
		const outdir = await mkdtemp(join(tmpdir(), "clip-build-"));
		tempDirs.push(outdir);

		const output = await Bun.build(createAppBuildConfig(outdir));
		const scriptOutputs = output.outputs.filter((artifact) =>
			artifact.path.endsWith(".js"),
		);
		const scripts = await Promise.all(
			scriptOutputs.map((artifact) => artifact.text()),
		);
		const bundleText = scripts.join("\n");

		expect(bundleText).not.toContain(
			"Download the React DevTools for a better development experience",
		);
		expect(bundleText).not.toContain("react-dom-client.development");
		expect(bundleText).not.toContain("react-jsx-dev-runtime.development");
		expect(bundleText).toContain("Minified React error #");
	});
});
