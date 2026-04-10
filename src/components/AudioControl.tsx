import { useCallback, useId, useMemo, useRef, useState } from "react";
import { formatTickLabel, formatValueText } from "../audio/formatValueText";
import { generateSnapPoints, getSnappedValue, presets } from "../audio/utils";
import { ContextMenu } from "./ContextMenu";
import { SnappableSlider } from "./SnappableSlider";

export interface AudioControlProps {
	label: string;
	controlKey?: string;
	min: number;
	max: number;
	value: number;
	defaultValue?: number;
	step?: number;
	tempo?: number;
	snap?: string;
	preset?: string;
	title?: string;
	enabled?: boolean;
	hasToggle?: boolean;
	hasSnap?: boolean;
	audioDuration?: number | null;
	maxLocked?: boolean;
	onChange?: (value: number) => void;
	onToggle?: (enabled: boolean) => void;
	onSnapChange?: (snap: string) => void;
	onMinChange?: (val: number) => void;
	onMaxChange?: (val: number) => void;
	onMaxLockedChange?: (locked: boolean) => void;
}

export function AudioControl({
	label,
	controlKey,
	min: propMin,
	max: propMax,
	value,
	defaultValue,
	step,
	tempo = 120,
	snap = "none",
	preset,
	title,
	enabled = true,
	hasToggle = false,
	hasSnap = false,
	audioDuration,
	maxLocked = false,
	onChange,
	onToggle,
	onSnapChange,
	onMinChange,
	onMaxChange,
	onMaxLockedChange,
}: AudioControlProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const labelId = useId();

	const presetConfig = preset ? presets[preset] : undefined;
	const resolvedMin = presetConfig?.min ?? propMin;
	const resolvedMax = presetConfig?.max ?? propMax;
	const tempoSnaps =
		snap !== "none" && !preset
			? generateSnapPoints(snap, tempo, resolvedMin, resolvedMax)
			: [];
	const resolvedSnaps = presetConfig?.snaps ?? tempoSnaps;
	const resolvedTicks = presetConfig?.ticks ?? [];
	const resolvedSkew = presetConfig?.skew ?? 1;
	const resolvedStep = step ?? presetConfig?.step;
	const resolvedLogarithmic = presetConfig?.logarithmic ?? false;

	const handleSliderChange = useCallback(
		(rawValue: number) => {
			if (!enabled) return;
			const snapped = getSnappedValue(rawValue, snap, tempo);
			onChange?.(snapped);
		},
		[snap, tempo, onChange, enabled],
	);

	const displayValue = formatValueText(value, controlKey, snap, tempo);

	const tickFormatter = useMemo(() => {
		if (preset || !controlKey) return undefined;
		return (v: number) => formatTickLabel(v, controlKey, snap, tempo);
	}, [preset, controlKey, snap, tempo]);

	const startEditing = useCallback(() => {
		setEditText(String(value));
		setIsEditing(true);
		queueMicrotask(() => {
			inputRef.current?.select();
		});
	}, [value]);

	const commitEdit = useCallback(() => {
		setIsEditing(false);
		const parsed = Number.parseFloat(editText);
		if (Number.isFinite(parsed)) {
			const clamped = Math.min(Math.max(parsed, resolvedMin), resolvedMax);
			onChange?.(clamped);
		}
	}, [editText, resolvedMin, resolvedMax, onChange]);

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

	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			if (!hasSnap) return;
			e.preventDefault();
			setCtxMenu({ x: e.clientX, y: e.clientY });
		},
		[hasSnap],
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: context menu on right-click is standard UX
		<div
			className={`audio-control${hasToggle && !enabled ? " audio-control--disabled" : ""}`}
			title={title}
			onContextMenu={handleContextMenu}
		>
			{hasToggle && (
				<input
					type="checkbox"
					className="control-toggle"
					checked={enabled}
					onChange={(e) => onToggle?.(e.target.checked)}
				/>
			)}
			{!hasToggle && <span className="control-toggle-placeholder" />}
			<span className="control-label" id={labelId}>
				{label}
			</span>
			<SnappableSlider
				min={resolvedMin}
				max={resolvedMax}
				value={value}
				skew={resolvedSkew}
				step={resolvedStep}
				defaultValue={defaultValue}
				enableSnap={snap !== "none" || !!preset}
				snaps={resolvedSnaps}
				ticks={resolvedTicks}
				logarithmic={resolvedLogarithmic}
				disabled={hasToggle && !enabled}
				labelId={labelId}
				valueText={displayValue}
				formatTick={tickFormatter}
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
			{ctxMenu && (
				<ContextMenu
					x={ctxMenu.x}
					y={ctxMenu.y}
					snap={snap}
					min={propMin}
					max={propMax}
					maxLocked={maxLocked}
					audioDuration={audioDuration ?? null}
					onSnapChange={(s) => {
						onSnapChange?.(s);
					}}
					onMinChange={(v) => onMinChange?.(v)}
					onMaxChange={(v) => onMaxChange?.(v)}
					onMaxLockedChange={(locked) => onMaxLockedChange?.(locked)}
					onClose={() => setCtxMenu(null)}
				/>
			)}
		</div>
	);
}
