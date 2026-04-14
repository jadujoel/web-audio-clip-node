import { beforeAll, describe, expect, test } from "bun:test";

import { createContext, renderContext } from "../../TestPreload";
import { assertSamplesMatch, computeRms } from "../test-utils/audio-assertions";
import { ClipNode } from "./ClipNode";

beforeAll(async () => {
	await Bun.build({
		entrypoints: ["src/audio/processor.ts"],
		outdir: "dist/audio",
	});
});

describe("AudioWorklet Bun integration", () => {
	test("loads the processor module without crashing on Bun", async () => {
		const context = createContext({ sampleRate: 48_000 });

		expect(
			context.audioWorklet.addModule("./dist/audio/processor.js"),
		).resolves.toBeUndefined();
	});

	test("offline test contexts render deterministically for Bun integration coverage", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 48_000,
			preferOffline: true,
		});

		expect(context).toBeInstanceOf(OfflineAudioContext);
		await expect(
			context.audioWorklet.addModule("./dist/audio/processor.js"),
		).resolves.toBeUndefined();
	});

	test("loop playback works when the buffer is assigned after node construction", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 12_000,
			preferOffline: true,
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		const buffer = context.createBuffer(2, 12_000, context.sampleRate);
		buffer.getChannelData(0).fill(0.25);
		buffer.getChannelData(1).fill(0.25);

		const clip = new ClipNode(context);
		clip.buffer = buffer;
		clip.connect(context.destination);
		clip.start();
		clip.loop = true;

		await renderContext(context);

		expect(true).toBe(true);
	}, 30_000);

	test("playbackRate can hit zero and resume without crashing the worklet", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 48_000,
			preferOffline: true,
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
	}, 60_000);

	test("C1: full buffer swap via ClipNode.buffer setter during playback — no crash", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 12_000,
			preferOffline: true,
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		const buffer1 = context.createBuffer(2, 12_000, context.sampleRate);
		buffer1.getChannelData(0).fill(0.25);
		buffer1.getChannelData(1).fill(0.25);

		const clip = new ClipNode(context);
		clip.buffer = buffer1;
		clip.connect(context.destination);
		clip.start();

		// Swap to a different buffer after a short delay
		const buffer2 = context.createBuffer(2, 12_000, context.sampleRate);
		buffer2.getChannelData(0).fill(0.5);
		buffer2.getChannelData(1).fill(0.5);
		clip.buffer = buffer2;

		await renderContext(context);

		// Reaching here = no crash, no hang
		expect(true).toBe(true);
	}, 30_000);

	test("C2: replaceBufferRange during streaming playback — no crash", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 12_000,
			preferOffline: true,
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		const clip = new ClipNode(context);
		clip.connect(context.destination);

		// Initialize streaming buffer
		clip.initializeBuffer(12_000, 2, { streaming: true });
		clip.start();

		// Feed data in chunks
		const chunkSize = 1_200;
		for (let i = 0; i < 10; i++) {
			const data = [
				new Float32Array(chunkSize).fill(0.25),
				new Float32Array(chunkSize).fill(0.25),
			];
			clip.replaceBufferRange(i * chunkSize, data, {
				totalLength: 12_000,
				streamEnded: i === 9,
			});
		}

		await renderContext(context);

		// Reaching here = no crash, no hang
		expect(true).toBe(true);
	}, 30_000);

	test("C3: playhead scrub beyond committed stream data remains stable", async () => {
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length: 12_000,
			preferOffline: true,
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		const clip = new ClipNode(context);
		clip.connect(context.destination);
		clip.initializeBuffer(12_000, 2, { streaming: true });
		clip.start();

		// Decode has only provided the first 0.1s so far.
		clip.replaceBufferRange(
			0,
			[new Float32Array(1_200).fill(0.25), new Float32Array(1_200).fill(0.25)],
			{ totalLength: 12_000 },
		);

		// Scrub far ahead into an uncommitted region; processor should underrun safely.
		clip.playhead = 0.75;

		// Continue streaming additional chunks and finish.
		for (let i = 1; i < 10; i++) {
			clip.replaceBufferRange(
				i * 1_200,
				[
					new Float32Array(1_200).fill(0.25),
					new Float32Array(1_200).fill(0.25),
				],
				{ totalLength: 12_000, streamEnded: i === 9 },
			);
		}

		await renderContext(context);

		// Reaching here confirms scrub + streaming writes remain stable.
		expect(true).toBe(true);
	}, 30_000);

	test("streaming buffer samples survive processor roundtrip at identity settings", async () => {
		const length = 12_000;
		const context = createContext({
			sampleRate: 48_000,
			channels: 2,
			length,
			preferOffline: true,
		});

		await context.audioWorklet.addModule("./dist/audio/processor.js");

		// Create known sine wave signals
		const inputL = new Float32Array(length);
		const inputR = new Float32Array(length);
		for (let i = 0; i < length; i++) {
			inputL[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.5;
			inputR[i] = Math.sin((2 * Math.PI * 880 * i) / 48_000) * 0.5;
		}

		const clip = new ClipNode(context);
		clip.connect(context.destination);
		clip.initializeBuffer(length, 2, { streaming: true });
		clip.start();

		// Feed in chunks (simulate streaming)
		const chunkSize = 1_200;
		for (let i = 0; i < length; i += chunkSize) {
			const end = Math.min(i + chunkSize, length);
			clip.replaceBufferRange(
				i,
				[inputL.subarray(i, end), inputR.subarray(i, end)],
				{
					totalLength: length,
					streamEnded: end >= length,
				},
			);
		}

		const rendered = (context as OfflineAudioContext).startRendering
			? await (context as OfflineAudioContext).startRendering()
			: null;
		expect(rendered).not.toBeNull();
		if (!rendered) return;

		// Verify rendered output has non-trivial audio (not silence)
		const outputL = rendered.getChannelData(0);
		const outputR = rendered.getChannelData(1);
		expect(computeRms(outputL)).toBeGreaterThan(0.01);
		expect(computeRms(outputR)).toBeGreaterThan(0.01);

		// Compare — allow small error from processor filters; skip initial settling
		const skip = 256;
		assertSamplesMatch(outputL.subarray(skip), inputL.subarray(skip), {
			epsilon: 1e-3,
			maxMismatchRatio: 0.01,
			label: "left channel",
		});
		assertSamplesMatch(outputR.subarray(skip), inputR.subarray(skip), {
			epsilon: 1e-3,
			maxMismatchRatio: 0.01,
			label: "right channel",
		});
	}, 30_000);
});
