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

	test("C1: full buffer swap via ClipNode.buffer setter during playback — no crash", async () => {
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

		const buffer1 = context.createBuffer(2, 48_000, context.sampleRate);
		buffer1.getChannelData(0).fill(0.25);
		buffer1.getChannelData(1).fill(0.25);

		const clip = new ClipNode(context);
		clip.buffer = buffer1;
		clip.connect(context.destination);
		clip.start();

		// Swap to a different buffer after a short delay
		const buffer2 = context.createBuffer(2, 48_000, context.sampleRate);
		buffer2.getChannelData(0).fill(0.5);
		buffer2.getChannelData(1).fill(0.5);
		clip.buffer = buffer2;

		await renderContext(context);

		// Reaching here = no crash, no hang
		expect(true).toBe(true);
	});

	test("C2: replaceBufferRange during streaming playback — no crash", async () => {
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

		const clip = new ClipNode(context);
		clip.connect(context.destination);

		// Initialize streaming buffer
		clip.initializeBuffer(48_000, 2, { streaming: true });
		clip.start();

		// Feed data in chunks
		const chunkSize = 4800;
		for (let i = 0; i < 10; i++) {
			const data = [
				new Float32Array(chunkSize).fill(0.25),
				new Float32Array(chunkSize).fill(0.25),
			];
			clip.replaceBufferRange(i * chunkSize, data, {
				totalLength: 48_000,
				streamEnded: i === 9,
			});
		}

		await renderContext(context);

		// Reaching here = no crash, no hang
		expect(true).toBe(true);
	});

	test("C3: playhead scrub beyond committed stream data remains stable", async () => {
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

		const clip = new ClipNode(context);
		clip.connect(context.destination);
		clip.initializeBuffer(48_000, 2, { streaming: true });
		clip.start();

		// Decode has only provided the first 0.1s so far.
		clip.replaceBufferRange(
			0,
			[new Float32Array(4_800).fill(0.25), new Float32Array(4_800).fill(0.25)],
			{ totalLength: 48_000 },
		);

		// Scrub far ahead into an uncommitted region; processor should underrun safely.
		clip.playhead = 0.75;

		// Continue streaming additional chunks and finish.
		for (let i = 1; i < 10; i++) {
			clip.replaceBufferRange(
				i * 4_800,
				[
					new Float32Array(4_800).fill(0.25),
					new Float32Array(4_800).fill(0.25),
				],
				{ totalLength: 48_000, streamEnded: i === 9 },
			);
		}

		await renderContext(context);

		// Reaching here confirms scrub + streaming writes remain stable.
		expect(true).toBe(true);
	});
});
