import { memo, useCallback, useId, useRef, useState } from "react";
import { presets } from "../audio/utils";
import { SnappableSlider } from "./SnappableSlider";

interface DetuneControlProps {
	value: number;
	defaultValue: number;
	enabled: boolean;
	onChange: (value: number) => void;
	onToggle: (enabled: boolean) => void;
}

function DetuneControlInner({
	value,
	defaultValue,
	enabled,
	onChange,
	onToggle,
}: DetuneControlProps) {
	const preset = presets.cents;
	const min = preset.min ?? -2400;
	const max = preset.max ?? 2400;
	const labelId = useId();
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const displayValue = `${Math.round(value)} cents`;

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
			title="Pitch shift in cents."
		>
			<input
				type="checkbox"
				className="control-toggle"
				checked={enabled}
				onChange={(e) => onToggle(e.target.checked)}
			/>
			<span className="control-label" id={labelId}>
				Detune
			</span>
			<SnappableSlider
				min={min}
				max={max}
				value={value}
				skew={preset.skew ?? 1}
				step={preset.step ?? 1}
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

export const DetuneControl = memo(DetuneControlInner);
