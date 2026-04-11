import { describe, expect, test } from "bun:test";

import "../../TestPreload";

describe("AudioWorklet Bun integration", () => {
	test("loads the processor module without crashing on Bun", async () => {
		const context = new AudioContext({ sampleRate: 48_000 });

		await Bun.build({
			entrypoints: ["src/audio/processor.ts"],
			outdir: "dist/audio",
		});

		expect(
			context.audioWorklet.addModule("./dist/audio/processor.js"),
		).resolves.toBeUndefined();

		await context.close();
	});
});
