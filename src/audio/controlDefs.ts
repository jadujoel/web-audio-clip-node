// ---------------------------------------------------------------------------
// Control definitions — shared configuration for all audio controls
// ---------------------------------------------------------------------------

export type ControlKey =
	| "playhead"
	| "offset"
	| "duration"
	| "startDelay"
	| "stopDelay"
	| "fadeIn"
	| "fadeOut"
	| "loopStart"
	| "loopEnd"
	| "loopCrossfade"
	| "playbackRate"
	| "detune"
	| "gain"
	| "pan"
	| "lowpass"
	| "highpass";

export interface ControlDef {
	key: ControlKey;
	label: string;
	min: number;
	max: number;
	defaultValue: number;
	precision?: number;
	snap?: string;
	preset?: string;
	title?: string;
	hasToggle?: boolean;
}

export const TEMPO = 116;
export const SAMPLE_RATE = 48000;

export const controlDefs: ControlDef[] = [
	{
		key: "playhead",
		label: "Playhead",
		min: 0,
		max: 480000,
		defaultValue: 0,
		precision: 1,
		snap: "int",
		title: "Current sample position of buffer playback.",
	},
	{
		key: "offset",
		label: "Offset",
		min: 0,
		max: 4,
		defaultValue: 0,
		snap: "bar",
		title: "Start position in the buffer (seconds).",
	},
	{
		key: "duration",
		label: "Duration",
		min: -1,
		max: 40,
		defaultValue: -1,
		title:
			"How long to play before auto-stopping (seconds). -1 for full length.",
	},
	{
		key: "startDelay",
		label: "StartDelay",
		min: 0,
		max: 4,
		defaultValue: 0,
		snap: "beat",
		title: "Delay before starting (seconds).",
	},
	{
		key: "stopDelay",
		label: "StopDelay",
		min: 0,
		max: 4,
		defaultValue: 0,
		snap: "beat",
		title: "Delay before stopping (seconds).",
	},
	{
		key: "fadeIn",
		label: "FadeIn",
		min: 0,
		max: 4,
		defaultValue: 0,
		snap: "beat",
		hasToggle: true,
		title: "Fade-in duration (seconds).",
	},
	{
		key: "fadeOut",
		label: "FadeOut",
		min: 0,
		max: 4,
		defaultValue: 0,
		snap: "beat",
		hasToggle: true,
		title: "Fade-out duration (seconds).",
	},
];

export const loopControlDefs: ControlDef[] = [
	{
		key: "loopStart",
		label: "LoopStart",
		min: 0,
		max: 1,
		defaultValue: 0,
		snap: "bar",
	},
	{
		key: "loopEnd",
		label: "LoopEnd",
		min: 0,
		max: 1,
		defaultValue: 0,
		snap: "bar",
	},
	{
		key: "loopCrossfade",
		label: "LoopCrossfade",
		min: 0,
		max: 1,
		defaultValue: 0,
		snap: "beat",
		hasToggle: true,
	},
];

export const paramDefs: ControlDef[] = [
	{
		key: "playbackRate",
		label: "PlaybackRate",
		min: -2,
		max: 2,
		defaultValue: 1,
		precision: 2,
		preset: "playbackRate",
		hasToggle: true,
		title: "Playback speed. Negative for reverse.",
	},
	{
		key: "detune",
		label: "Detune",
		min: -2400,
		max: 2400,
		defaultValue: 0,
		precision: 4,
		preset: "cents",
		hasToggle: true,
		title: "Pitch shift in cents.",
	},
	{
		key: "gain",
		label: "Gain",
		min: -100,
		max: 0,
		defaultValue: 0,
		precision: 3,
		preset: "gain",
		hasToggle: true,
		title: "Amplitude in dB.",
	},
	{
		key: "pan",
		label: "Pan",
		min: -1,
		max: 1,
		defaultValue: 0,
		preset: "pan",
		hasToggle: true,
		title: "-1 full left, 1 full right.",
	},
	{
		key: "lowpass",
		label: "Lowpass",
		min: 32,
		max: 16385,
		defaultValue: 16384,
		preset: "hertz",
		hasToggle: true,
		title: "Lowpass cutoff frequency.",
	},
	{
		key: "highpass",
		label: "Highpass",
		min: 32,
		max: 16384,
		defaultValue: 32,
		preset: "hertz",
		hasToggle: true,
		title: "Highpass cutoff frequency.",
	},
];

export const allDefs = [...controlDefs, ...loopControlDefs, ...paramDefs];

export function buildDefaults(): {
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
} {
	const values = {} as Record<ControlKey, number>;
	const snaps = {} as Record<ControlKey, string>;
	const enabled = {} as Record<ControlKey, boolean>;
	for (const d of allDefs) {
		values[d.key] = d.defaultValue;
		snaps[d.key] = d.snap ?? "none";
		enabled[d.key] = true;
	}
	return { values, snaps, enabled };
}
