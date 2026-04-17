import type { Page } from "@playwright/test";

/**
 * Injects an audio-level monitor into the page by monkey-patching
 * AudioNode.prototype.connect. Any node that connects to an
 * AudioContext.destination will also feed an AnalyserNode stored
 * on `window.__audioAnalyser`.
 *
 * Must be called BEFORE the page navigates (uses addInitScript).
 */
export async function injectAudioMonitor(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const originalConnect = AudioNode.prototype.connect as (
			destination: AudioNode | AudioParam,
			output?: number,
			input?: number,
		) => AudioNode | undefined;
		const win = window as unknown as { __audioAnalyser?: AnalyserNode };

		// biome-ignore lint/suspicious/noExplicitAny: patching overloaded native connect method
		(AudioNode.prototype as any).connect = function (
			destination: AudioNode | AudioParam,
			...rest: number[]
		) {
			// Detect connection to destination — route ALL such connections
			// through the shared analyser so the monitor survives graph rewiring.
			if (destination instanceof AudioDestinationNode) {
				const ctx = this.context as AudioContext;
				if (!win.__audioAnalyser) {
					const analyser = ctx.createAnalyser();
					analyser.fftSize = 2048;
					analyser.smoothingTimeConstant = 0;
					win.__audioAnalyser = analyser;
					originalConnect.call(analyser, destination);
				}
				originalConnect.call(this, win.__audioAnalyser);
				return destination;
			}

			// Default passthrough
			return originalConnect.call(this, destination, ...rest);
		};
	});
}

export interface AudioLevel {
	/** Root-mean-square of byte frequency data (0–255 scale). */
	rms: number;
	/** Maximum value in byte frequency data. */
	peak: number;
}

/**
 * Reads the current audio level from the injected AnalyserNode.
 * Returns `null` if the monitor hasn't been activated yet.
 */
export async function getAudioLevel(page: Page): Promise<AudioLevel | null> {
	return page.evaluate(() => {
		const win = window as unknown as { __audioAnalyser?: AnalyserNode };
		const analyser = win.__audioAnalyser;
		if (!analyser) return null;

		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteTimeDomainData(data);

		// Compute RMS over time-domain data (centered at 128)
		let sumSq = 0;
		for (let i = 0; i < data.length; i++) {
			const v = (data[i] - 128) / 128;
			sumSq += v * v;
		}
		const rms = Math.sqrt(sumSq / data.length);
		const peak = Math.max(...data);
		return { rms, peak };
	});
}

export interface SustainedAudioResult {
	/** Total number of samples taken. */
	totalSamples: number;
	/** Number of samples where audio was detected. */
	activeSamples: number;
	/** Longest consecutive run of silent samples. */
	longestSilentRun: number;
	/** All collected RMS values for debugging. */
	rmsValues: number[];
}

/**
 * Polls audio levels for `durationMs` at `intervalMs` intervals.
 * Returns statistics about how sustained the audio was.
 *
 * @param silenceThreshold - RMS below this value counts as silence (default 0.005).
 */
export async function measureAudioSustain(
	page: Page,
	durationMs: number,
	intervalMs = 100,
	silenceThreshold = 0.005,
): Promise<SustainedAudioResult> {
	const iterations = Math.ceil(durationMs / intervalMs);
	const rmsValues: number[] = [];
	let activeSamples = 0;
	let longestSilentRun = 0;
	let currentSilentRun = 0;

	for (let i = 0; i < iterations; i++) {
		const level = await getAudioLevel(page);
		const rms = level?.rms ?? 0;
		rmsValues.push(rms);

		if (rms >= silenceThreshold) {
			activeSamples++;
			currentSilentRun = 0;
		} else {
			currentSilentRun++;
			longestSilentRun = Math.max(longestSilentRun, currentSilentRun);
		}

		if (i < iterations - 1) {
			await page.waitForTimeout(intervalMs);
		}
	}

	return {
		totalSamples: iterations,
		activeSamples,
		longestSilentRun,
		rmsValues,
	};
}
