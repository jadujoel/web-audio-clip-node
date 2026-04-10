import type { ControlDef, ControlKey } from "../audio/controlDefs";
import { TEMPO } from "../audio/controlDefs";
import { AudioControl } from "./AudioControl";

interface ControlSectionProps {
	legend: string;
	defs: ControlDef[];
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	onValueChange: (key: ControlKey, val: number) => void;
	onToggle: (key: ControlKey, on: boolean) => void;
	onSnapChange: (key: ControlKey, snap: string) => void;
}

export function ControlSection({
	legend,
	defs,
	values,
	snaps,
	enabled,
	onValueChange,
	onToggle,
	onSnapChange,
}: ControlSectionProps) {
	return (
		<fieldset className="control-group">
			<legend>{legend}</legend>
			{defs.map((def) => (
				<AudioControl
					key={def.key}
					label={def.label}
					controlKey={def.key}
					min={def.min}
					max={def.max}
					value={values[def.key]}
					defaultValue={def.defaultValue}
					precision={def.precision}
					tempo={TEMPO}
					snap={snaps[def.key]}
					preset={def.preset}
					title={def.title}
					enabled={enabled[def.key]}
					hasToggle={def.hasToggle}
					hasSnap={def.hasSnap}
					onChange={(v) => onValueChange(def.key, v)}
					onToggle={(on) => onToggle(def.key, on)}
					onSnapChange={(s) => onSnapChange(def.key, s)}
				/>
			))}
		</fieldset>
	);
}
