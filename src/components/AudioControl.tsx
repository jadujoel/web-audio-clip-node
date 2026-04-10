import { useCallback, useState } from "react";
import { getSnappedValue, getUnitValue, presets } from "../audio/utils";
import { SnappableSlider } from "./SnappableSlider";

export interface AudioControlProps {
	label: string;
	min: number;
	max: number;
	value: number;
	precision?: number;
	tempo?: number;
	snap?: string;
	preset?: string;
	transform?: string;
	title?: string;
	enabled?: boolean;
	hasToggle?: boolean;
	onChange?: (value: number) => void;
	onToggle?: (enabled: boolean) => void;
	onSnapChange?: (snap: string) => void;
}

export function AudioControl({
	label,
	min: propMin,
	max: propMax,
	value,
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
			<label className="control-label" htmlFor={`control-snap-${label}`}>
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
				enableSnap={!!preset}
				snaps={resolvedSnaps}
				onChange={handleSliderChange}
			/>
			<output className="control-output">{displayValue}</output>
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
