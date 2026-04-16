import { describe, expect, it } from "vitest";
import { createDuckProcessorState, processDuckBlock } from "./kernel";

const BLOCK_SIZE = 128;
const SAMPLE_RATE = 48_000;

function makeChannels(channels: number, length = BLOCK_SIZE): Float32Array[] {
	return Array.from({ length: channels }, () => new Float32Array(length));
}

function makeParams(overrides: Partial<Record<string, number>> = {}) {
	return {
		threshold: new Float32Array([overrides.threshold ?? 0.01]),
		attack: new Float32Array([overrides.attack ?? 0.01]),
		release: new Float32Array([overrides.release ?? 0.5]),
		depth: new Float32Array([overrides.depth ?? 0.8]),
	};
}

function fillChannels(channels: Float32Array[], value: number) {
	for (const ch of channels) ch.fill(value);
}

describe("duck-processor-kernel", () => {
	describe("processDuckBlock", () => {
		it("passes signal through unchanged when sidechain is silent", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(2);
			fillChannels(mainInput, 0.5);
			const sidechain = makeChannels(1);
			// sidechain is all zeros
			const output = makeChannels(2);
			const params = makeParams();

			processDuckBlock(
				state,
				mainInput,
				sidechain,
				output,
				params,
				SAMPLE_RATE,
			);

			// Output should be very close to input (smoothedGain starts at 1)
			for (let i = 0; i < BLOCK_SIZE; i++) {
				expect(output[0]![i]).toBeCloseTo(0.5, 1);
				expect(output[1]![i]).toBeCloseTo(0.5, 1);
			}
		});

		it("reduces gain when sidechain has a loud signal", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(2);
			fillChannels(mainInput, 0.5);
			const sidechain = makeChannels(1);
			sidechain[0]!.fill(0.8); // loud sidechain
			const output = makeChannels(2);
			const params = makeParams({ depth: 0.8, threshold: 0.01 });

			// Run several blocks to let the envelope settle
			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}

			// After settling, gain should be significantly reduced
			const lastSample = output[0]![BLOCK_SIZE - 1]!;
			expect(lastSample).toBeLessThan(0.2);
			expect(lastSample).toBeGreaterThan(0);
		});

		it("returns to full volume when sidechain goes silent", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(2);
			fillChannels(mainInput, 0.5);
			const sidechain = makeChannels(1);
			const output = makeChannels(2);
			const params = makeParams({ release: 0.01 }); // fast release

			// First, duck with loud sidechain
			sidechain[0]!.fill(0.8);
			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}
			const duckedLevel = output[0]![BLOCK_SIZE - 1]!;
			expect(duckedLevel).toBeLessThan(0.3);

			// Now remove sidechain signal — gain should recover
			sidechain[0]!.fill(0);
			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}
			const recoveredLevel = output[0]![BLOCK_SIZE - 1]!;
			expect(recoveredLevel).toBeCloseTo(0.5, 1);
		});

		it("handles empty sidechain (no connection)", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(2);
			fillChannels(mainInput, 0.5);
			const output = makeChannels(2);
			const params = makeParams();

			// Pass empty array for sidechain (disconnected)
			processDuckBlock(state, mainInput, [], output, params, SAMPLE_RATE);

			for (let i = 0; i < BLOCK_SIZE; i++) {
				expect(output[0]![i]).toBeCloseTo(0.5, 1);
			}
		});

		it("handles empty main input", () => {
			const state = createDuckProcessorState();
			const output = makeChannels(2);
			const params = makeParams();

			// No main input
			processDuckBlock(state, [], [], output, params, SAMPLE_RATE);

			// Output should be all zeros (no channels to copy from)
			for (let i = 0; i < BLOCK_SIZE; i++) {
				expect(output[0]![i]).toBe(0);
				expect(output[1]![i]).toBe(0);
			}
		});

		it("respects depth parameter (0 means no ducking)", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(1);
			fillChannels(mainInput, 0.5);
			const sidechain = makeChannels(1);
			sidechain[0]!.fill(0.9);
			const output = makeChannels(1);
			const params = makeParams({ depth: 0 });

			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}

			// With depth=0, no ducking should occur
			expect(output[0]![BLOCK_SIZE - 1]).toBeCloseTo(0.5, 1);
		});

		it("respects threshold parameter", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(1);
			fillChannels(mainInput, 0.5);
			const sidechain = makeChannels(1);
			sidechain[0]!.fill(0.05); // quiet sidechain
			const output = makeChannels(1);
			const params = makeParams({ threshold: 0.1 }); // high threshold

			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}

			// Sidechain (0.05) is below threshold (0.1), so no ducking
			expect(output[0]![BLOCK_SIZE - 1]).toBeCloseTo(0.5, 1);
		});

		it("mono-sums multi-channel sidechain", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(1);
			fillChannels(mainInput, 0.5);
			// Two sidechain channels at 0.4 each → average 0.4
			const sidechain = makeChannels(2);
			sidechain[0]!.fill(0.4);
			sidechain[1]!.fill(0.4);
			const output = makeChannels(1);
			const params = makeParams({ threshold: 0.01, depth: 0.8 });

			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}

			// Should be ducked (sidechain average 0.4 > threshold 0.01)
			expect(output[0]![BLOCK_SIZE - 1]).toBeLessThan(0.4);
			expect(output[0]![BLOCK_SIZE - 1]).toBeLessThan(0.5); // clearly reduced from 0.5
		});

		it("applies same gain to both channels (stereo linking)", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(2);
			mainInput[0]!.fill(0.3);
			mainInput[1]!.fill(0.7);
			const sidechain = makeChannels(1);
			sidechain[0]!.fill(0.5);
			const output = makeChannels(2);
			const params = makeParams();

			for (let block = 0; block < 200; block++) {
				processDuckBlock(
					state,
					mainInput,
					sidechain,
					output,
					params,
					SAMPLE_RATE,
				);
			}

			// Both channels should have the same gain ratio
			const ratioL = output[0]![BLOCK_SIZE - 1]! / 0.3;
			const ratioR = output[1]![BLOCK_SIZE - 1]! / 0.7;
			expect(ratioL).toBeCloseTo(ratioR, 5);
		});

		it("state carries envelope across multiple blocks", () => {
			const state = createDuckProcessorState();
			const mainInput = makeChannels(1);
			fillChannels(mainInput, 1.0);
			const sidechain = makeChannels(1);
			sidechain[0]!.fill(0.5);
			const output = makeChannels(1);
			const params = makeParams({ attack: 0.01 });

			processDuckBlock(
				state,
				mainInput,
				sidechain,
				output,
				params,
				SAMPLE_RATE,
			);
			expect(state.envelope).toBeGreaterThan(0);

			const envelopeAfterBlock1 = state.envelope;
			processDuckBlock(
				state,
				mainInput,
				sidechain,
				output,
				params,
				SAMPLE_RATE,
			);
			// Envelope should continue increasing
			expect(state.envelope).toBeGreaterThan(envelopeAfterBlock1);
		});
	});

	describe("createDuckProcessorState", () => {
		it("initializes with zero envelope and unity gain", () => {
			const state = createDuckProcessorState();
			expect(state.envelope).toBe(0);
			expect(state.smoothedGain).toBe(1);
		});
	});
});
