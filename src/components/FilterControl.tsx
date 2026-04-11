import { memo, useCallback, useId, useRef, useState } from "react";
import { presets } from "../audio/utils";
import { SnappableSlider } from "./SnappableSlider";

interface FilterControlProps {
	label: string;
	controlKey: string;
	value: number;
	defaultValue: number;
	enabled: boolean;
	onChange: (value: number) => void;
	onToggle: (enabled: boolean) => void;
}

function formatHz(value: number): string {
	if (value >= 1000) return `${(value / 1000).toFixed(1)} kHz`;
	return `${Math.round(value)} Hz`;
}

function FilterControlInner({
	label,
	controlKey: _controlKey,
	value,
	defaultValue,
	enabled,
	onChange,
	onToggle,
}: FilterControlProps) {
	const preset = presets.hertz;
	const min = preset.min ?? 32;
	const max = preset.max ?? 16384;
	const labelId = useId();
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const handleChange = useCallback(
		(v: number) => {
			if (!enabled) return;
			onChange(v);
		},
		[enabled, onChange],
	);

	const startEditing = useCallback(() => {
		setEditText(String(Math.round(value)));
		setIsEditing(true);
		queueMicrotask(() => inputRef.current?.select());
	}, [value]);

	const commitEdit = useCallback(() => {
		setIsEditing(false);
		const parsed = Number.parseFloat(editText);
		if (Number.isFinite(parsed)) {
			onChange(Math.min(Math.max(parsed, min), max));
		}
	}, [editText, min, max, onChange]);

	const handleEditKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commitEdit();
			} else if (e.key === "Escape") {
				e.preventDefault();
				setIsEditing(false);
			}
		},
		[commitEdit],
	);

	const disabled = !enabled;

	return (
		<div
			className={`audio-control${disabled ? " audio-control--disabled" : ""}`}
			title={`${label} cutoff frequency.`}
		>
			<input
				type="checkbox"
				className="control-toggle"
				checked={enabled}
				onChange={(e) => onToggle(e.target.checked)}
			/>
			<span className="control-label" id={labelId}>
				{label}
			</span>
			<SnappableSlider
				min={min}
				max={max}
				value={value}
				logarithmic
				defaultValue={defaultValue}
				enableSnap
				snaps={preset.snaps ?? []}
				ticks={preset.ticks ?? []}
				disabled={disabled}
				labelId={labelId}
				valueText={formatHz(value)}
				onChange={handleChange}
			/>
			{isEditing ? (
				<input
					ref={inputRef}
					type="text"
					className="control-output control-output--editing"
					value={editText}
					onChange={(e) => setEditText(e.target.value)}
					onBlur={commitEdit}
					onKeyDown={handleEditKeyDown}
				/>
			) : (
				<button type="button" className="control-output" onClick={startEditing}>
					{formatHz(value)}
				</button>
			)}
		</div>
	);
}

export const FilterControl = memo(FilterControlInner);
