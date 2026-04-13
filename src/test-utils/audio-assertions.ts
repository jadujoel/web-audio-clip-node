export interface SampleComparisonResult {
	matches: boolean;
	maxDiff: number;
	mismatchCount: number;
	mismatchRatio: number;
	lengthDiff: number;
}

/** Compare two Float32Arrays sample-by-sample within tolerance. */
export function compareSamples(
	actual: Float32Array,
	expected: Float32Array,
	epsilon = 1e-4,
): SampleComparisonResult {
	const lengthDiff = actual.length - expected.length;
	const minLen = Math.min(actual.length, expected.length);
	let maxDiff = 0;
	let mismatchCount = 0;

	for (let i = 0; i < minLen; i++) {
		const diff = Math.abs(actual[i] - expected[i]);
		if (diff > maxDiff) maxDiff = diff;
		if (diff > epsilon) mismatchCount++;
	}

	// Any length difference counts as mismatches
	mismatchCount += Math.abs(lengthDiff);
	const totalSamples = Math.max(actual.length, expected.length, 1);

	return {
		matches: mismatchCount === 0 && lengthDiff === 0,
		maxDiff,
		mismatchCount,
		mismatchRatio: mismatchCount / totalSamples,
		lengthDiff,
	};
}

/** Assert two audio buffers match within tolerance with descriptive errors. */
export function assertSamplesMatch(
	actual: Float32Array,
	expected: Float32Array,
	opts?: { epsilon?: number; maxMismatchRatio?: number; label?: string },
): void {
	const epsilon = opts?.epsilon ?? 1e-4;
	const maxMismatchRatio = opts?.maxMismatchRatio ?? 0;
	const label = opts?.label ?? "samples";

	const result = compareSamples(actual, expected, epsilon);

	if (result.lengthDiff !== 0) {
		throw new Error(
			`${label}: length mismatch — actual ${actual.length}, expected ${expected.length} (diff ${result.lengthDiff})`,
		);
	}

	if (result.mismatchRatio > maxMismatchRatio) {
		throw new Error(
			`${label}: ${result.mismatchCount}/${actual.length} samples differ beyond ε=${epsilon} ` +
				`(ratio ${result.mismatchRatio.toFixed(6)}, max allowed ${maxMismatchRatio}), ` +
				`maxDiff=${result.maxDiff.toFixed(8)}`,
		);
	}
}

/** Compute RMS level of a Float32Array. */
export function computeRms(data: Float32Array): number {
	if (data.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		sum += data[i] * data[i];
	}
	return Math.sqrt(sum / data.length);
}

/** Compute peak absolute level. */
export function computePeakLevel(data: Float32Array): number {
	let peak = 0;
	for (let i = 0; i < data.length; i++) {
		const abs = Math.abs(data[i]);
		if (abs > peak) peak = abs;
	}
	return peak;
}
