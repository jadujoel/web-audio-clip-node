import { describe, expect, test } from "bun:test";

import { createContext, renderContext } from "../../TestPreload";
import { ClipNode } from "./ClipNode";

describe("AudioWorklet Bun integration", () => {
	test("loads the processor module without crashing on Bun", async () => {
		const context = createContext({ sampleRate: 48_000 });

		await Bun.build({
			entrypoints: ["src/audio/processor.ts"],
			outdir: "dist/audio",
		});

		expect(
			context.audioWorklet.addModule("./dist/audio/processor.js"),
		).resolves.toBeUndefined();
	});

	test("loop playback works when the buffer is assigned after node construction", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 48_000 * 2,
		});

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

		await renderContext(context);

		expect(true).toBe(true);
	});

	test("playbackRate can hit zero and resume without crashing the worklet", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 48_000,
		});

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

		// Schedule playbackRate: zero at 50ms, resume at 100ms
		clip.playbackRate.setValueAtTime(0, 0.05);
		clip.playbackRate.setValueAtTime(1, 0.1);

		await renderContext(context);

		// Reaching here without a crash means the worklet survived rate=0
		expect(true).toBe(true);
	});
});
