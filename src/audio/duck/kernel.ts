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
}

export function createDuckProcessorState(): DuckProcessorState {
	return { envelope: 0, smoothedGain: 1 };
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
		return;
	}

	const hasSidechain = sidechain.length > 0 && (sidechain[0]?.length ?? 0) > 0;

	let { envelope, smoothedGain } = state;

	for (let i = 0; i < blockSize; i++) {
		// --- Read per-sample parameters (a-rate) or use first value (k-rate) ---
		const threshold = params.threshold[i] ?? params.threshold[0] ?? 0.01;
		const attackTime = params.attack[i] ?? params.attack[0] ?? 0.01;
		const releaseTime = params.release[i] ?? params.release[0] ?? 0.5;
		const depth = params.depth[i] ?? params.depth[0] ?? 0.8;

		// --- 1. Mono-sum the sidechain and take absolute value ---
		let triggerLevel = 0;
		if (hasSidechain) {
			for (let ch = 0; ch < sidechain.length; ch++) {
				triggerLevel += Math.abs(sidechain[ch]![i]!);
			}
			triggerLevel /= sidechain.length;
		}

		// --- 2. Envelope follower (one-pole IIR, separate attack/release) ---
		const attackCoeff = 1 - Math.exp(-1 / (sr * Math.max(attackTime, 1e-6)));
		const releaseCoeff = 1 - Math.exp(-1 / (sr * Math.max(releaseTime, 1e-6)));

		if (triggerLevel > envelope) {
			envelope += attackCoeff * (triggerLevel - envelope);
		} else {
			envelope += releaseCoeff * (triggerLevel - envelope);
		}

		// --- 3. Compute target gain ---
		let targetGain: number;
		if (envelope > threshold) {
			const reduction =
				depth *
				Math.min(1, (envelope - threshold) / Math.max(0.001, 1 - threshold));
			targetGain = 1 - reduction;
		} else {
			targetGain = 1;
		}

		// --- 4. Smooth gain to avoid zipper noise ---
		const smoothCoeff = 0.005;
		smoothedGain += smoothCoeff * (targetGain - smoothedGain);

		// --- 5. Apply gain to all main input channels ---
		for (let ch = 0; ch < numChannels; ch++) {
			output[ch]![i] = mainInput[ch]![i]! * smoothedGain;
		}
		// Zero any extra output channels
		for (let ch = numChannels; ch < output.length; ch++) {
			output[ch]![i] = 0;
		}
	}

	state.envelope = envelope;
	state.smoothedGain = smoothedGain;
}
