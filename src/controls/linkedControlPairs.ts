import type { ControlKey } from "./controlDefs";

export type LinkedControlPairKey = "fadeOutStopDelay" | "loopStartEnd";

export interface LinkedControlPairDef {
	key: LinkedControlPairKey;
	label: string;
	controls: readonly [ControlKey, ControlKey];
}

export const transportLinkedControlPairs: readonly LinkedControlPairDef[] = [
	{
		key: "fadeOutStopDelay",
		label: "Link StopDelay and FadeOut",
		controls: ["stopDelay", "fadeOut"],
	},
];

export const loopLinkedControlPairs: readonly LinkedControlPairDef[] = [
	{
		key: "loopStartEnd",
		label: "Link Start and End",
		controls: ["loopStart", "loopEnd"],
	},
];

const allLinkedControlPairs = [
	...transportLinkedControlPairs,
	...loopLinkedControlPairs,
];

export function buildLinkedControlPairDefaults(): Record<
	LinkedControlPairKey,
	boolean
> {
	return {
		fadeOutStopDelay: false,
		loopStartEnd: false,
	};
}

export function getLinkedControlPairForControl(
	controlKey: ControlKey,
): LinkedControlPairDef | undefined {
	return allLinkedControlPairs.find(
		(pair) =>
			pair.controls[0] === controlKey || pair.controls[1] === controlKey,
	);
}

export function getActiveLinkedControls(
	controlKey: ControlKey,
	linkedPairs: Record<LinkedControlPairKey, boolean>,
): readonly ControlKey[] {
	const pair = getLinkedControlPairForControl(controlKey);
	if (pair && linkedPairs[pair.key]) {
		return pair.controls;
	}

	return [controlKey];
}

export function getLinkedControlUpdates({
	pair,
	changedKey,
	nextValue,
	values,
	mins,
	maxs,
}: {
	pair: LinkedControlPairDef;
	changedKey: ControlKey;
	nextValue: number;
	values: Record<ControlKey, number>;
	mins: Record<ControlKey, number>;
	maxs: Record<ControlKey, number>;
}): Partial<Record<ControlKey, number>> {
	const [firstKey, secondKey] = pair.controls;
	if (changedKey !== firstKey && changedKey !== secondKey) {
		return { [changedKey]: nextValue };
	}

	const otherKey = changedKey === firstKey ? secondKey : firstKey;
	const currentChanged = values[changedKey];
	const currentOther = values[otherKey];
	const requestedShift = nextValue - currentChanged;
	const minShift = Math.max(
		mins[changedKey] - currentChanged,
		mins[otherKey] - currentOther,
	);
	const maxShift = Math.min(
		maxs[changedKey] - currentChanged,
		maxs[otherKey] - currentOther,
	);
	const appliedShift = Math.min(Math.max(requestedShift, minShift), maxShift);

	return {
		[changedKey]: currentChanged + appliedShift,
		[otherKey]: currentOther + appliedShift,
	};
}
