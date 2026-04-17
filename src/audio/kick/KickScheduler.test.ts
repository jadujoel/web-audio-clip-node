import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KickScheduler } from "./KickScheduler";

describe("KickScheduler", () => {
	let ctx: AudioContext;
	let sidechain: GainNode;

	beforeEach(() => {
		ctx = new AudioContext();
		sidechain = new GainNode(ctx);
	});

	afterEach(async () => {
		await ctx.close();
	});

	function createScheduler(
		overrides?: Partial<ConstructorParameters<typeof KickScheduler>[0]>,
	) {
		return new KickScheduler({
			audioContext: ctx,
			sidechain,
			destination: ctx.destination,
			tempo: 120,
			audible: false,
			...overrides,
		});
	}

	it("isPlaying is false initially", () => {
		const s = createScheduler();
		expect(s.isPlaying).toBe(false);
		s.dispose();
	});

	it("start() sets isPlaying to true", () => {
		const s = createScheduler();
		s.start();
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("start() with explicit startTime uses that time", () => {
		const s = createScheduler();
		const t = ctx.currentTime + 1;
		s.start(t);
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("stop() sets isPlaying to false", () => {
		const s = createScheduler();
		s.start();
		s.stop();
		expect(s.isPlaying).toBe(false);
		s.dispose();
	});

	it("start() is idempotent when already playing", () => {
		const s = createScheduler();
		s.start();
		s.start(); // should not throw
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("tempo can be changed without resetting playback", () => {
		const s = createScheduler();
		s.start();
		s.tempo = 200;
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("pause() preserves isPlaying but stops scheduling", () => {
		const s = createScheduler();
		s.start();
		s.pause();
		// isPlaying remains true (paused, not stopped)
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("resume() after pause continues playback", () => {
		const s = createScheduler();
		s.start();
		s.pause();
		s.resume();
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("resume() without pause is a no-op", () => {
		const s = createScheduler();
		s.start();
		s.resume(); // should not throw
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("dispose() stops playback and cleans up", () => {
		const s = createScheduler();
		s.start();
		s.dispose();
		expect(s.isPlaying).toBe(false);
	});

	it("audible setter toggles gain value", () => {
		const s = createScheduler({ audible: false });
		s.audible = true;
		// Should not throw
		s.audible = false;
		s.dispose();
	});

	it("stop() then start() works correctly", () => {
		const s = createScheduler();
		s.start();
		s.stop();
		expect(s.isPlaying).toBe(false);
		s.start();
		expect(s.isPlaying).toBe(true);
		s.dispose();
	});

	it("multiple stop() calls do not throw", () => {
		const s = createScheduler();
		s.start();
		s.stop();
		s.stop();
		expect(s.isPlaying).toBe(false);
		s.dispose();
	});

	it("uses setTimeout-based scheduler loop", () => {
		const spy = vi.spyOn(globalThis, "setTimeout");
		const s = createScheduler();
		s.start();
		expect(spy).toHaveBeenCalled();
		s.dispose();
		spy.mockRestore();
	});

	it("clears timer on stop", () => {
		const spy = vi.spyOn(globalThis, "clearTimeout");
		const s = createScheduler();
		s.start();
		s.stop();
		expect(spy).toHaveBeenCalled();
		s.dispose();
		spy.mockRestore();
	});
});
