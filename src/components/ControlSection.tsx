import { memo, useId } from "react";
import type { ControlDef, ControlKey } from "../controls/controlDefs";
import type {
	LinkedControlPairDef,
	LinkedControlPairKey,
} from "../controls/linkedControlPairs";
import { AudioControl } from "./AudioControl";

interface ControlSectionProps {
	legend: string;
	defs: ControlDef[];
	disabledKeys?: Set<ControlKey>;
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	mins: Record<ControlKey, number>;
	maxs: Record<ControlKey, number>;
	maxLocked: Record<ControlKey, boolean>;
	linked?: Record<LinkedControlPairKey, boolean>;
	linkedPairs?: readonly LinkedControlPairDef[];
	tempo: number;
	audioDuration?: number | null;
	onValueChange: (key: ControlKey, val: number) => void;
	onToggle: (key: ControlKey, on: boolean) => void;
	onLinkedChange?: (key: LinkedControlPairKey, linked: boolean) => void;
	onSnapChange: (key: ControlKey, snap: string) => void;
	onMinChange: (key: ControlKey, val: number) => void;
	onMaxChange: (key: ControlKey, val: number) => void;
	onMaxLockedChange: (key: ControlKey, locked: boolean) => void;
}

/** Build a set of control keys that belong to a linked pair,
 *  and a map from the first control key to its pair def. */
function buildPairMaps(pairs?: readonly LinkedControlPairDef[]) {
	const pairByFirst = new Map<ControlKey, LinkedControlPairDef>();
	const pairedKeys = new Set<ControlKey>();
	if (pairs) {
		for (const pair of pairs) {
			pairByFirst.set(pair.controls[0], pair);
			pairedKeys.add(pair.controls[0]);
			pairedKeys.add(pair.controls[1]);
		}
	}
	return { pairByFirst, pairedKeys };
}

function renderAudioControl(
	def: ControlDef,
	props: Omit<
		ControlSectionProps,
		"legend" | "defs" | "linked" | "linkedPairs" | "onLinkedChange"
	>,
) {
	const {
		disabledKeys,
		mins,
		maxs,
		maxLocked,
		audioDuration,
		values,
		tempo,
		snaps,
		enabled,
		onValueChange,
		onToggle,
		onSnapChange,
		onMinChange,
		onMaxChange,
		onMaxLockedChange,
	} = props;
	return (
		<AudioControl
			key={def.key}
			label={def.label}
			controlKey={def.key}
			min={mins[def.key] ?? def.min}
			max={
				maxLocked[def.key] && audioDuration != null
					? audioDuration
					: (maxs[def.key] ?? def.max)
			}
			value={values[def.key]}
			defaultValue={def.defaultValue}
			tempo={tempo}
			snap={snaps[def.key]}
			preset={def.preset}
			title={def.title}
			enabled={enabled[def.key]}
			hasToggle={def.hasToggle}
			hasSnap={def.hasSnap}
			hasMaxLock={def.hasMaxLock}
			audioDuration={audioDuration}
			maxLocked={maxLocked[def.key] ?? true}
			forceDisabled={disabledKeys?.has(def.key) === true}
			onChange={(v) => onValueChange(def.key, v)}
			onToggle={(on) => onToggle(def.key, on)}
			onSnapChange={(s) => onSnapChange(def.key, s)}
			onMinChange={(v) => onMinChange(def.key, v)}
			onMaxChange={(v) => onMaxChange(def.key, v)}
			onMaxLockedChange={(locked) => onMaxLockedChange(def.key, locked)}
		/>
	);
}

function ControlSectionInner({
	legend,
	defs,
	linked,
	linkedPairs,
	onLinkedChange,
	...controlProps
}: ControlSectionProps) {
	const sectionId = useId();
	const { pairByFirst, pairedKeys } = buildPairMaps(linkedPairs);

	const items: React.ReactNode[] = [];
	let i = 0;
	while (i < defs.length) {
		const def = defs[i];
		const pair = pairByFirst.get(def.key);

		if (pair) {
			// Find the second control in the pair
			const secondDef = defs.find((d) => d.key === pair.controls[1]);
			const isLinked = linked?.[pair.key] ?? false;
			const inputId = `${sectionId}-${pair.key}`;

			items.push(
				<div
					className={`control-link-group${isLinked ? " control-link-group--active" : ""}`}
					key={`link-${pair.key}`}
				>
					<div className="control-link-bracket">
						<span className="control-link-line" />
						<button
							type="button"
							id={inputId}
							className="control-link-btn"
							aria-pressed={isLinked}
							aria-label={pair.label}
							title={pair.label}
							onClick={() => onLinkedChange?.(pair.key, !isLinked)}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true"
							>
								<path
									d="M6.5 4.5h-1A2.5 2.5 0 0 0 3 7v2a2.5 2.5 0 0 0 2.5 2.5h1m3-7h1A2.5 2.5 0 0 1 13 7v2a2.5 2.5 0 0 1-2.5 2.5h-1M5.5 8h5"
									stroke="currentColor"
									strokeWidth="1.3"
									strokeLinecap="round"
								/>
							</svg>
						</button>
						<span className="control-link-line" />
					</div>
					<div className="control-link-controls">
						{renderAudioControl(def, controlProps)}
						{secondDef && renderAudioControl(secondDef, controlProps)}
					</div>
				</div>,
			);

			// Skip past both controls in the pair
			i += 1;
			if (secondDef && defs[i]?.key === secondDef.key) {
				i += 1;
			}
			continue;
		}

		// Not part of a pair (or is a second control already rendered above)
		if (!pairedKeys.has(def.key)) {
			items.push(renderAudioControl(def, controlProps));
		}
		i += 1;
	}

	return (
		<fieldset className="control-group">
			<legend>{legend}</legend>
			{items}
		</fieldset>
	);
}

function areControlSectionPropsEqual(
	prev: ControlSectionProps,
	next: ControlSectionProps,
) {
	return (
		prev.legend === next.legend &&
		prev.defs === next.defs &&
		prev.values === next.values &&
		prev.snaps === next.snaps &&
		prev.enabled === next.enabled &&
		prev.mins === next.mins &&
		prev.maxs === next.maxs &&
		prev.maxLocked === next.maxLocked &&
		prev.disabledKeys === next.disabledKeys &&
		prev.linked === next.linked &&
		prev.linkedPairs === next.linkedPairs &&
		prev.tempo === next.tempo &&
		prev.audioDuration === next.audioDuration &&
		prev.onValueChange === next.onValueChange &&
		prev.onToggle === next.onToggle &&
		prev.onLinkedChange === next.onLinkedChange &&
		prev.onSnapChange === next.onSnapChange &&
		prev.onMinChange === next.onMinChange &&
		prev.onMaxChange === next.onMaxChange &&
		prev.onMaxLockedChange === next.onMaxLockedChange
	);
}

export const ControlSection = memo(
	ControlSectionInner,
	areControlSectionPropsEqual,
);
