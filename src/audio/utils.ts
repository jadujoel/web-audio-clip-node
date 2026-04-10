export function dbFromLin(lin: number): number {
	return Math.max(20 * Math.log10(lin), -1000);
}

export function linFromDb(db: number): number {
	return 10 ** (db / 20);
}

export function getSnappedValue(
	value: number,
	snap: string,
	tempo: number,
): number {
	switch (snap) {
		case "beat": {
			const spb = 60 / tempo;
			return Math.round(value / spb) * spb;
		}
		case "bar": {
			const spbar = (60 / tempo) * 4;
			return Math.round(value / spbar) * spbar;
		}
		case "8th": {
			const sp8 = 60 / tempo / 8;
			return Math.round(value / sp8) * sp8;
		}
		case "16th": {
			const sp16 = 60 / tempo / 16;
			return Math.round(value / sp16) * sp16;
		}
		case "int":
			return Math.round(value);
		default:
			return value;
	}
}

export function getUnitValue(value: number, unit: string): number {
	switch (unit) {
		case "dB":
			return dbFromLin(value);
		case "log10":
			return Math.log10(value);
		case "log2":
			return Math.log2(value);
		default:
			return value;
	}
}

export interface SliderPreset {
	snaps?: number[];
	min?: number;
	max?: number;
	skew?: number;
}

export const presets: Record<string, SliderPreset> = {
	hertz: {
		snaps: [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384],
		min: 32,
		max: 16384,
		skew: 0.25,
	},
	decibel: {
		snaps: [-60, -48, -36, -24, -12, -6, -3, 0],
		min: -60,
		max: 0,
		skew: 1,
	},
	cents: {
		snaps: Array.from({ length: 49 }, (_, i) => (i - 24) * 100),
		min: -2400,
		max: 2400,
		skew: 1,
	},
	playbackRate: {
		snaps: [
			-4, -3, -2, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1,
			1.25, 1.5, 2, 3, 4,
		],
		min: -4,
		max: 4,
		skew: 1,
	},
	gain: {
		snaps: [
			-60, -50, -40, -30, -27, -24, -21, -18, -15, -12, -9, -8, -7, -6, -5, -4,
			-3, -2, -1, 0,
		],
		min: -100,
		max: 0,
		skew: 6,
	},
	pan: {
		snaps: [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1],
		min: -1,
		max: 1,
		skew: 1,
	},
};

export function float32ArrayFromAudioBuffer(
	buffer: AudioBuffer,
): Float32Array[] {
	return buffer.numberOfChannels === 1
		? [buffer.getChannelData(0)]
		: [buffer.getChannelData(0), buffer.getChannelData(1)];
}

export function audioBufferFromFloat32Array(
	context: BaseAudioContext,
	data?: Float32Array[],
): AudioBuffer | undefined {
	if (!data || data.length === 0) return undefined;
	const buffer = context.createBuffer(
		data.length,
		data[0].length,
		context.sampleRate,
	);
	for (let i = 0; i < data.length; i++) {
		buffer.copyToChannel(new Float32Array(data[i]), i);
	}
	return buffer;
}
