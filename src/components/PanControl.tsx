import { useCallback, useId, useRef, useState } from "react";
import { presets } from "../audio/utils";
import { SnappableSlider } from "./SnappableSlider";

interface PanControlProps {
	value: number;
	defaultValue: number;
	enabled: boolean;
	onChange: (value: number) => void;
	onToggle: (enabled: boolean) => void;
}

function formatPan(value: number): string {
	if (Math.abs(value) < 0.005) return "C";
	const pct = Math.round(Math.abs(value) * 100);
	return value < 0 ? `L${pct}` : `R${pct}`;
}

export function PanControl({
	value,
	defaultValue,
	enabled,
	onChange,
	onToggle,
}: PanControlProps) {
	const preset = presets.pan;
	const min = preset.min ?? -1;
	const max = preset.max ?? 1;
	const labelId = useId();
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const displayValue = formatPan(value);

	const handleChange = useCallback(
		(v: number) => {
			if (!enabled) return;
			onChange(v);
		},
		[enabled, onChange],
	);

	const startEditing = useCallback(() => {
		setEditText(String(value));
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
			title="-1 full left, 1 full right."
		>
			<input
				type="checkbox"
				className="control-toggle"
				checked={enabled}
				onChange={(e) => onToggle(e.target.checked)}
			/>
			<span className="control-label" id={labelId}>
				Pan
			</span>
			<SnappableSlider
				min={min}
				max={max}
				value={value}
				skew={preset.skew ?? 1}
				defaultValue={defaultValue}
				ticks={preset.ticks ?? []}
				disabled={disabled}
				labelId={labelId}
				valueText={displayValue}
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
					{displayValue}
				</button>
			)}
		</div>
	);
}
