import type { ControlDef, ControlKey } from "../audio/controlDefs";
import { TEMPO } from "../audio/controlDefs";
import { AudioControl } from "./AudioControl";

interface ControlSectionProps {
	legend: string;
	defs: ControlDef[];
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	mins: Record<ControlKey, number>;
	maxs: Record<ControlKey, number>;
	maxLocked: Record<ControlKey, boolean>;
	audioDuration?: number | null;
	onValueChange: (key: ControlKey, val: number) => void;
	onToggle: (key: ControlKey, on: boolean) => void;
	onSnapChange: (key: ControlKey, snap: string) => void;
	onMinChange: (key: ControlKey, val: number) => void;
	onMaxChange: (key: ControlKey, val: number) => void;
	onMaxLockedChange: (key: ControlKey, locked: boolean) => void;
}

export function ControlSection({
	legend,
	defs,
	values,
	snaps,
	enabled,
	mins,
	maxs,
	maxLocked,
	audioDuration,
	onValueChange,
	onToggle,
	onSnapChange,
	onMinChange,
	onMaxChange,
	onMaxLockedChange,
}: ControlSectionProps) {
	return (
		<fieldset className="control-group">
			<legend>{legend}</legend>
			{defs.map((def) => (
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
					tempo={TEMPO}
					snap={snaps[def.key]}
					preset={def.preset}
					title={def.title}
					enabled={enabled[def.key]}
					hasToggle={def.hasToggle}
					hasSnap={def.hasSnap}
					audioDuration={audioDuration}
					maxLocked={maxLocked[def.key] ?? true}
					onChange={(v) => onValueChange(def.key, v)}
					onToggle={(on) => onToggle(def.key, on)}
					onSnapChange={(s) => onSnapChange(def.key, s)}
					onMinChange={(v) => onMinChange(def.key, v)}
					onMaxChange={(v) => onMaxChange(def.key, v)}
					onMaxLockedChange={(locked) => onMaxLockedChange(def.key, locked)}
				/>
			))}
		</fieldset>
	);
}
