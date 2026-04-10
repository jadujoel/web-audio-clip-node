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

export interface SliderPreset {
	snaps?: number[];
	ticks?: number[];
	min?: number;
	max?: number;
	skew?: number;
	step?: number;
	logarithmic?: boolean;
}

export const presets: Record<string, SliderPreset> = {
	hertz: {
		snaps: [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384],
		ticks: [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384],
		min: 32,
		max: 16384,
		logarithmic: true,
	},
	decibel: {
		ticks: [-48, -24, -12, -6, -3, 0],
		min: -60,
		max: 0,
		skew: 1,
	},
	cents: {
		snaps: Array.from({ length: 49 }, (_, i) => (i - 24) * 100), // semitones: -2400..2400 by 100
		ticks: [-2400, -1200, 0, 1200, 2400],
		min: -2400,
		max: 2400,
		skew: 1,
		step: 1,
	},
	playbackRate: {
		snaps: [-2, -1, -0.5, 0, 0.5, 1, 1.5, 2],
		ticks: [-2, -1, 0, 1, 2],
		min: -2,
		max: 2,
		skew: 1,
	},
	gain: {
		snaps: [-60, -48, -36, -24, -18, -12, -9, -6, -3, -1, 0],
		ticks: [-48, -24, -12, -6, -3, 0],
		min: -100,
		max: 0,
		skew: 6,
	},
	pan: {
		snaps: [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1],
		ticks: [-1, -0.5, 0, 0.5, 1],
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

export function generateSnapPoints(
	snap: string,
	tempo: number,
	min: number,
	max: number,
): number[] {
	let interval: number;
	switch (snap) {
		case "beat":
			interval = 60 / tempo;
			break;
		case "bar":
			interval = (60 / tempo) * 4;
			break;
		case "8th":
			interval = 60 / tempo / 2;
			break;
		case "16th":
			interval = 60 / tempo / 4;
			break;
		case "int":
			interval = 1;
			break;
		default:
			return [];
	}
	if (interval <= 0) return [];
	const points: number[] = [];
	const start = Math.ceil(min / interval) * interval;
	for (let v = start; v <= max; v += interval) {
		points.push(Math.round(v * 1e10) / 1e10);
	}
	return points;
}
