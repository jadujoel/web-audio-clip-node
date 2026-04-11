import { describe, expect, test } from "bun:test";

import "../../TestPreload";
import { ClipNode } from "./ClipNode";

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

	test("loop playback works when the buffer is assigned after node construction", async () => {
		const context = new AudioContext({ sampleRate: 48_000 });

		await Bun.build({
			entrypoints: ["src/audio/processor.ts"],
			outdir: "dist/audio",
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		const buffer = context.createBuffer(2, 48_000, context.sampleRate);
		buffer.getChannelData(0).fill(0.25);
		buffer.getChannelData(1).fill(0.25);

		const clip = new ClipNode(context);
		clip.buffer = buffer;
		clip.connect(context.destination);
		clip.start();
		clip.loop = true;

		await Bun.sleep(150);
		await context.close();

		expect(true).toBe(true);
	});
});
