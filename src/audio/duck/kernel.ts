/**
 * Duck-processor kernel — pure DSP logic for sidechain ducking.
 * Runs inside an AudioWorkletProcessor but has no worklet-specific dependencies,
 * so it can be unit-tested in Node / Bun.
 */

export interface DuckProcessorState {
	/** Current envelope level (linear, 0–1+). */
	envelope: number;
	/** Current smoothed gain applied to the main signal. */
	smoothedGain: number;
	/** Running RMS accumulator for the sidechain. */
	rmsAccumulator: number;
	/** Hold counter in samples — keeps ducking active between trigger events. */
	holdCounter: number;
	/** Per-channel circular delay buffers for lookahead. */
	delayBuffers: Float32Array[];
	/** Write position in the delay buffer. */
	delayWritePos: number;
	/** Allocated delay buffer size in samples. */
	delayBufferSize: number;
	/** Most recent gain reduction in dB (0 = no reduction, negative = ducking). */
	currentReductionDb: number;
}

export function createDuckProcessorState(): DuckProcessorState {
	return {
		envelope: 0,
		smoothedGain: 1,
		rmsAccumulator: 0,
		holdCounter: 0,
		delayBuffers: [],
		delayWritePos: 0,
		delayBufferSize: 0,
		currentReductionDb: 0,
	};
}

/**
 * Process one render quantum (128 samples) of sidechain ducking.
 *
 * @param state      Mutable envelope/gain state carried across quanta.
 * @param mainInput  Main signal channels to duck  (may be empty).
 * @param sidechain  Sidechain trigger channels     (may be empty).
 * @param output     Output channels to write into.
 * @param params     Per-sample or single-value parameter arrays.
 * @param sr         Current sample rate.
 */
export function processDuckBlock(
	state: DuckProcessorState,
	mainInput: Float32Array[],
	sidechain: Float32Array[],
	output: Float32Array[],
	params: {
		threshold: Float32Array;
		attack: Float32Array;
		release: Float32Array;
		depth: Float32Array;
		lookAhead: Float32Array;
	},
	sr: number,
	bypass = false,
): void {
	const blockSize = output[0]?.length ?? 0;
	if (blockSize === 0) return;

	const numChannels = Math.min(mainInput.length, output.length);

	// Bypass: copy main input straight to output
	if (bypass) {
		for (let ch = 0; ch < numChannels; ch++) {
			output[ch]!.set(mainInput[ch]!);
		}
		for (let ch = numChannels; ch < output.length; ch++) {
			output[ch]!.fill(0);
		}
		// Reset state so ducking starts clean when re-enabled
		state.envelope = 0;
		state.smoothedGain = 1;
		state.rmsAccumulator = 0;
		state.holdCounter = 0;
		state.currentReductionDb = 0;
		for (const buf of state.delayBuffers) buf.fill(0);
		state.delayWritePos = 0;
		return;
	}

	const hasSidechain = sidechain.length > 0 && (sidechain[0]?.length ?? 0) > 0;

	let { envelope, smoothedGain, rmsAccumulator, holdCounter } = state;

	// --- Lookahead delay buffer setup (k-rate: read once per block) ---
	const lookAheadSec = params.lookAhead[0] ?? 0;
	const delaySamples = Math.ceil(lookAheadSec * sr);
	const useLookahead = delaySamples > 0;

	if (useLookahead) {
		// Max buffer size for 50ms at current sample rate
		const maxBufSize = Math.ceil(0.05 * sr);
		const neededSize = Math.min(delaySamples, maxBufSize);
		// Allocate or grow delay buffers if needed
		if (state.delayBufferSize < neededSize) {
			const newSize = maxBufSize; // Allocate max to avoid re-allocation
			const newBuffers: Float32Array[] = [];
			for (let ch = 0; ch < numChannels; ch++) {
				const newBuf = new Float32Array(newSize);
				// Copy old data if present
				const oldBuf = state.delayBuffers[ch];
				if (oldBuf) {
					const copyLen = Math.min(oldBuf.length, newSize);
					newBuf.set(oldBuf.subarray(0, copyLen));
				}
				newBuffers.push(newBuf);
			}
			state.delayBuffers = newBuffers;
			state.delayBufferSize = newSize;
		}
		// Ensure enough channels
		while (state.delayBuffers.length < numChannels) {
			state.delayBuffers.push(new Float32Array(state.delayBufferSize));
		}
	}

	let delayWritePos = state.delayWritePos;
	const delayBufSize = state.delayBufferSize;

	// RMS window: ~15ms — balances responsiveness with stability
	const rmsWindowSamples = Math.max(1, Math.round(sr * 0.015));
	const rmsDecayCoeff = 1 / rmsWindowSamples;

	// Hold time: 150ms — bridges gaps between syllables/hits
	const holdSamples = Math.round(sr * 0.15);

	// Soft knee width in dB
	const kneeDb = 6;
	const halfKnee = kneeDb / 2;

	// Sample-rate-aware gain smoothing: 5ms time constant
	const smoothCoeff = 1 - Math.exp(-1 / (sr * 0.005));

	for (let i = 0; i < blockSize; i++) {
		// --- Read per-sample parameters (a-rate) or use first value (k-rate) ---
		const threshold = params.threshold[i] ?? params.threshold[0] ?? 0.02;
		const attackTime = params.attack[i] ?? params.attack[0] ?? 0.02;
		const releaseTime = params.release[i] ?? params.release[0] ?? 0.6;
		const depth = params.depth[i] ?? params.depth[0] ?? 0.8;

		// --- 1. RMS-based level detection (mono-sum sidechain) ---
		let samplePower = 0;
		if (hasSidechain) {
			let monoSum = 0;
			for (let ch = 0; ch < sidechain.length; ch++) {
				monoSum += sidechain[ch]![i]!;
			}
			monoSum /= sidechain.length;
			samplePower = monoSum * monoSum;
		}
		rmsAccumulator += rmsDecayCoeff * (samplePower - rmsAccumulator);
		const rmsLevel = Math.sqrt(Math.max(0, rmsAccumulator));

		// --- 2. Envelope follower (one-pole IIR, separate attack/release) ---
		const attackCoeff = 1 - Math.exp(-1 / (sr * Math.max(attackTime, 1e-6)));
		const releaseCoeff = 1 - Math.exp(-1 / (sr * Math.max(releaseTime, 1e-6)));

		if (rmsLevel > envelope) {
			envelope += attackCoeff * (rmsLevel - envelope);
		} else {
			envelope += releaseCoeff * (rmsLevel - envelope);
		}

		// --- 3. Hold time — keep ducking active briefly after trigger drops ---
		if (envelope > threshold) {
			holdCounter = holdSamples;
		} else if (holdCounter > 0) {
			holdCounter--;
		}

		// --- 4. dB-domain gain computation with soft knee ---
		let targetGain: number;
		const isActive = holdCounter > 0 || envelope > threshold;
		if (isActive && depth > 0) {
			const envelopeDb = 20 * Math.log10(Math.max(envelope, 1e-6));
			const thresholdDb = 20 * Math.log10(Math.max(threshold, 1e-6));
			// Max reduction in dB (depth 0–1 maps to 0 to -24 dB)
			const maxReductionDb = depth * 24;
			// How far above threshold the range extends (from threshold to 0 dBFS)
			const rangeDb = Math.max(0.1, -thresholdDb);
			const overDb = envelopeDb - thresholdDb;

			let reductionDb: number;
			if (overDb < -halfKnee) {
				// Below the knee: no reduction
				reductionDb = 0;
			} else if (overDb > halfKnee) {
				// Above the knee: full ratio reduction
				reductionDb =
					maxReductionDb * Math.min(1, (overDb - halfKnee) / rangeDb);
			} else {
				// Inside the knee: quadratic interpolation for smooth onset
				const x = overDb + halfKnee;
				reductionDb = maxReductionDb * ((x * x) / (2 * kneeDb * rangeDb));
			}
			// Convert dB reduction to linear gain
			targetGain = 10 ** (-reductionDb / 20);
		} else {
			targetGain = 1;
		}

		// --- 5. Sample-rate-aware gain smoothing ---
		smoothedGain += smoothCoeff * (targetGain - smoothedGain);

		// --- 6. Apply gain to all main input channels (with optional delay) ---
		if (useLookahead) {
			for (let ch = 0; ch < numChannels; ch++) {
				const buf = state.delayBuffers[ch]!;
				// Write current sample into delay buffer
				buf[delayWritePos % delayBufSize] = mainInput[ch]![i]!;
				// Read delayed sample
				const readPos =
					(delayWritePos - delaySamples + delayBufSize) % delayBufSize;
				output[ch]![i] = buf[readPos]! * smoothedGain;
			}
			delayWritePos = (delayWritePos + 1) % delayBufSize;
		} else {
			for (let ch = 0; ch < numChannels; ch++) {
				output[ch]![i] = mainInput[ch]![i]! * smoothedGain;
			}
		}
		// Zero any extra output channels
		for (let ch = numChannels; ch < output.length; ch++) {
			output[ch]![i] = 0;
		}
	}

	// Track the most recent gain reduction in dB
	state.currentReductionDb =
		smoothedGain >= 1 ? 0 : 20 * Math.log10(smoothedGain);

	state.envelope = envelope;
	state.smoothedGain = smoothedGain;
	state.rmsAccumulator = rmsAccumulator;
	state.holdCounter = holdCounter;
	state.delayWritePos = delayWritePos;
}
