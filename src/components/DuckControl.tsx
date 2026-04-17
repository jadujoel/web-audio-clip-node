import {
	memo,
	type NamedExoticComponent,
	useCallback,
	useId,
	useRef,
	useState,
} from "react";
import { SnappableSlider } from "./SnappableSlider";

export interface DuckControlProps {
	/** Threshold in dBFS (-60 to 0). */
	threshold: number;
	attack: number;
	release: number;
	/** Depth in percent (0–100). */
	depth: number;
	enabled: boolean;
	onThresholdChange: (value: number) => void;
	onAttackChange: (value: number) => void;
	onReleaseChange: (value: number) => void;
	onDepthChange: (value: number) => void;
	onToggle: (enabled: boolean) => void;
}

function ParamRow({
	label,
	min,
	max,
	value,
	step,
	defaultValue,
	skew,
	unit,
	decimals,
	disabled,
	onChange,
}: {
	label: string;
	min: number;
	max: number;
	value: number;
	step?: number;
	defaultValue: number;
	skew?: number;
	unit: string;
	decimals: number;
	disabled: boolean;
	onChange: (v: number) => void;
}) {
	const labelId = useId();
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const displayValue = `${value.toFixed(decimals)} ${unit}`;

	const handleChange = useCallback(
		(v: number) => {
			if (disabled) return;
			onChange(v);
		},
		[disabled, onChange],
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

	return (
		<div
			className={`audio-control${disabled ? " audio-control--disabled" : ""}`}
		>
			<span className="control-toggle-placeholder" />
			<span className="control-label" id={labelId}>
				{label}
			</span>
			<SnappableSlider
				min={min}
				max={max}
				value={value}
				step={step}
				defaultValue={defaultValue}
				skew={skew}
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

function DuckControlInner({
	threshold,
	attack,
	release,
	depth,
	enabled,
	onThresholdChange,
	onAttackChange,
	onReleaseChange,
	onDepthChange,
	onToggle,
}: DuckControlProps): React.JSX.Element {
	const disabled = !enabled;

	return (
		<fieldset className="control-group">
			<legend>
				Sidechain Duck
				<input
					type="checkbox"
					className="control-toggle"
					checked={enabled}
					onChange={(e) => onToggle(e.target.checked)}
					style={{ marginLeft: 8 }}
				/>
			</legend>
			<ParamRow
				label="Threshold"
				min={-100}
				max={0}
				value={threshold}
				step={0.5}
				defaultValue={-40}
				unit="dBFS"
				decimals={1}
				disabled={disabled}
				onChange={onThresholdChange}
			/>
			<ParamRow
				label="Attack"
				min={0.001}
				max={1}
				value={attack}
				step={0.001}
				defaultValue={0.01}
				skew={0.3}
				unit="s"
				decimals={3}
				disabled={disabled}
				onChange={onAttackChange}
			/>
			<ParamRow
				label="Release"
				min={0.01}
				max={5}
				value={release}
				step={0.01}
				defaultValue={0.5}
				skew={0.3}
				unit="s"
				decimals={2}
				disabled={disabled}
				onChange={onReleaseChange}
			/>
			<ParamRow
				label="Depth"
				min={0}
				max={100}
				value={depth}
				step={1}
				defaultValue={80}
				unit="%"
				decimals={0}
				disabled={disabled}
				onChange={onDepthChange}
			/>
		</fieldset>
	);
}

export const DuckControl: NamedExoticComponent<DuckControlProps> =
	memo(DuckControlInner);
