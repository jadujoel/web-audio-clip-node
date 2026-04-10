export function formatValueText(
	value: number,
	key: string | undefined,
	snap: string,
	tempo: number,
): string {
	switch (key) {
		case "gain":
			return `${value.toFixed(1)} dB`;
		case "lowpass":
		case "highpass":
			return `${Math.round(value)} Hz`;
		case "detune":
			return `${Math.round(value)} cents`;
		case "pan":
			if (value === 0) return "center";
			return value < 0
				? `${Math.abs(value).toFixed(2)} left`
				: `${value.toFixed(2)} right`;
		case "playbackRate":
			return `${value.toFixed(2)}x`;
		case "playhead":
			return `sample ${Math.round(value)}`;
		default:
			break;
	}

	// Time-based snaps
	if (snap === "beat" || snap === "bar") {
		const spb = 60 / tempo;
		if (snap === "bar") {
			const bars = value / (spb * 4);
			return `${bars.toFixed(1)} bars`;
		}
		const beats = value / spb;
		return `${beats.toFixed(1)} beats`;
	}

	return value.toPrecision(4);
}
