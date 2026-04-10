import { useCallback, useId, useRef, useState } from "react";
import { formatValueText } from "../audio/formatValueText";
import { getSnappedValue, getUnitValue, presets } from "../audio/utils";
import { SnappableSlider } from "./SnappableSlider";

export interface AudioControlProps {
	label: string;
	controlKey?: string;
	min: number;
	max: number;
	value: number;
	defaultValue?: number;
	step?: number;
	precision?: number;
	tempo?: number;
	snap?: string;
	preset?: string;
	title?: string;
	enabled?: boolean;
	hasToggle?: boolean;
	onChange?: (value: number) => void;
	onToggle?: (enabled: boolean) => void;
	onSnapChange?: (snap: string) => void;
}

export function AudioControl({
	label,
	controlKey,
	min: propMin,
	max: propMax,
	value,
	defaultValue,
	step,
	precision = 5,
	tempo = 120,
	snap = "none",
	preset,
	title,
	enabled = true,
	hasToggle = false,
	onChange,
	onToggle,
	onSnapChange,
}: AudioControlProps) {
	const [unit, setUnit] = useState("lin");
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const labelId = useId();

	const presetConfig = preset ? presets[preset] : undefined;
	const resolvedMin = presetConfig?.min ?? propMin;
	const resolvedMax = presetConfig?.max ?? propMax;
	const resolvedSnaps = presetConfig?.snaps ?? [];
	const resolvedSkew = presetConfig?.skew ?? 1;

	const handleSliderChange = useCallback(
		(rawValue: number) => {
			const snapped = getSnappedValue(rawValue, snap, tempo);
			onChange?.(snapped);
		},
		[snap, tempo, onChange],
	);

	const displayValue = (() => {
		const uv = getUnitValue(value, unit);
		return Number.isFinite(uv) ? uv.toPrecision(precision) : "0";
	})();

	const startEditing = useCallback(() => {
		setEditText(displayValue);
		setIsEditing(true);
		queueMicrotask(() => {
			inputRef.current?.select();
		});
	}, [displayValue]);

	const commitEdit = useCallback(() => {
		setIsEditing(false);
		const parsed = Number.parseFloat(editText);
		if (Number.isFinite(parsed)) {
			const resolvedMin = presetConfig?.min ?? propMin;
			const resolvedMax = presetConfig?.max ?? propMax;
			const clamped = Math.min(Math.max(parsed, resolvedMin), resolvedMax);
			onChange?.(clamped);
		}
	}, [editText, presetConfig, propMin, propMax, onChange]);

	const cancelEdit = useCallback(() => {
		setIsEditing(false);
	}, []);

	const handleEditKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commitEdit();
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelEdit();
			}
		},
		[commitEdit, cancelEdit],
	);

	return (
		<div className="audio-control" title={title}>
			{hasToggle && (
				<input
					type="checkbox"
					className="control-toggle"
					checked={enabled}
					onChange={(e) => onToggle?.(e.target.checked)}
				/>
			)}
			{!hasToggle && <span className="control-toggle-placeholder" />}
			<label
				className="control-label"
				id={labelId}
				htmlFor={`control-snap-${label}`}
			>
				{label}
			</label>
			<select
				id={`control-snap-${label}`}
				className="control-snap"
				value={snap}
				onChange={(e) => onSnapChange?.(e.target.value)}
			>
				<option value="none">None</option>
				<option value="beat">Beat</option>
				<option value="bar">Bar</option>
				<option value="8th">8th</option>
				<option value="16th">16th</option>
				<option value="int">Int</option>
				<option value="log10">log10</option>
				<option value="log2">log2</option>
			</select>
			<SnappableSlider
				min={resolvedMin}
				max={resolvedMax}
				value={value}
				skew={resolvedSkew}
				step={step}
				defaultValue={defaultValue}
				enableSnap={!!preset}
				snaps={resolvedSnaps}
				labelId={labelId}
				valueText={formatValueText(value, controlKey, snap, tempo)}
				onChange={handleSliderChange}
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
			<select
				className="control-unit"
				value={unit}
				onChange={(e) => setUnit(e.target.value)}
			>
				<option value="lin">lin</option>
				<option value="dB">dB</option>
				<option value="log10">log10</option>
				<option value="log2">log2</option>
			</select>
		</div>
	);
}
