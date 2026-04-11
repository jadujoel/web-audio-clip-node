import { useCallback, useMemo, useRef, useState } from "react";

interface DragBounds {
	left: number;
	width: number;
}

export interface SnappableSliderProps {
	min: number;
	max: number;
	value: number;
	skew?: number;
	step?: number;
	defaultValue?: number;
	enableSnap?: boolean;
	snaps?: number[];
	ticks?: number[];
	logarithmic?: boolean;
	disabled?: boolean;
	labelId?: string;
	valueText?: string;
	formatTick?: (value: number) => string;
	onChange?: (value: number) => void;
}

export function SnappableSlider({
	min,
	max,
	value,
	skew = 1,
	step,
	defaultValue,
	enableSnap = false,
	snaps = [],
	ticks = [],
	logarithmic = false,
	disabled = false,
	labelId,
	valueText,
	formatTick,
	onChange,
}: SnappableSliderProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isDragging = useRef(false);
	const isOptionKeyHeld = useRef(false);
	const dragBoundsRef = useRef<DragBounds | null>(null);
	const [altHeld, setAltHeld] = useState(false);

	const resolvedStep = step ?? (max - min) / 100;

	const getRatioFromValue = useCallback(
		(v: number) => {
			if (logarithmic) {
				if (min <= 0 || max <= 0) return 0;
				const clamped = Math.max(v, min);
				return Math.log(clamped / min) / Math.log(max / min);
			}
			const range = max - min;
			if (range === 0) return 0;
			const normalized = (v - min) / range;
			return skew === 1 ? normalized : Math.max(normalized, 0) ** skew;
		},
		[min, max, skew, logarithmic],
	);

	const getValueFromRatio = useCallback(
		(ratio: number) => {
			if (logarithmic) {
				if (min <= 0 || max <= 0) return min;
				return min * (max / min) ** ratio;
			}
			const adjusted = skew === 1 ? ratio : ratio ** (1 / skew);
			return adjusted * (max - min) + min;
		},
		[min, max, skew, logarithmic],
	);

	const getSnapped = useCallback(
		(v: number) => {
			if (!enableSnap || snaps.length === 0 || isOptionKeyHeld.current)
				return v;
			return snaps.reduce((closest, snap) =>
				Math.abs(snap - v) < Math.abs(closest - v) ? snap : closest,
			);
		},
		[enableSnap, snaps],
	);

	const clampAndEmit = useCallback(
		(raw: number) => {
			const clamped = Math.min(Math.max(raw, min), max);
			const snapped = getSnapped(clamped);
			onChange?.(snapped);
		},
		[min, max, getSnapped, onChange],
	);

	const updateFromClientX = useCallback(
		(clientX: number) => {
			const el = containerRef.current;
			if (!el) return;
			const bounds = dragBoundsRef.current ?? el.getBoundingClientRect();
			const { left, width } = bounds;
			if (width <= 0) return;
			const ratio = Math.min(Math.max((clientX - left) / width, 0), 1);
			const raw = getValueFromRatio(ratio);
			const snapped = getSnapped(raw);
			onChange?.(snapped);
		},
		[getValueFromRatio, getSnapped, onChange],
	);

	const startDrag = useCallback(
		(clientX: number, altKey: boolean) => {
			if (disabled) return;
			const el = containerRef.current;
			if (!el) return;
			dragBoundsRef.current = el.getBoundingClientRect();
			isDragging.current = true;
			isOptionKeyHeld.current = altKey;
			setAltHeld(altKey);
			updateFromClientX(clientX);

			const handleMove = (e: MouseEvent) => {
				if (isOptionKeyHeld.current !== e.altKey) {
					isOptionKeyHeld.current = e.altKey;
					setAltHeld(e.altKey);
				}
				updateFromClientX(e.clientX);
			};
			const handleTouchMove = (e: TouchEvent) =>
				updateFromClientX(e.touches[0].clientX);
			const handleUp = () => {
				isDragging.current = false;
				isOptionKeyHeld.current = false;
				dragBoundsRef.current = null;
				setAltHeld(false);
				document.removeEventListener("mousemove", handleMove);
				document.removeEventListener("mouseup", handleUp);
				document.removeEventListener("touchmove", handleTouchMove);
				document.removeEventListener("touchend", handleUp);
			};

			document.addEventListener("mousemove", handleMove);
			document.addEventListener("mouseup", handleUp);
			document.addEventListener("touchmove", handleTouchMove);
			document.addEventListener("touchend", handleUp);
		},
		[updateFromClientX, disabled],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Alt") {
				isOptionKeyHeld.current = true;
				setAltHeld(true);
				return;
			}

			if (disabled) return;

			let newValue = value;
			const s = resolvedStep;
			const bigStep = s * 10;

			switch (e.key) {
				case "ArrowRight":
				case "ArrowUp":
					newValue = value + s;
					break;
				case "ArrowLeft":
				case "ArrowDown":
					newValue = value - s;
					break;
				case "PageUp":
					newValue = value + bigStep;
					break;
				case "PageDown":
					newValue = value - bigStep;
					break;
				case "Home":
					newValue = min;
					break;
				case "End":
					newValue = max;
					break;
				default:
					return;
			}
			e.preventDefault();
			clampAndEmit(newValue);
		},
		[value, resolvedStep, min, max, clampAndEmit, disabled],
	);

	const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
		if (e.key === "Alt") {
			isOptionKeyHeld.current = false;
			setAltHeld(false);
		}
	}, []);

	const handleDoubleClick = useCallback(() => {
		if (disabled) return;
		if (defaultValue !== undefined) {
			onChange?.(defaultValue);
		}
	}, [defaultValue, onChange, disabled]);

	const ratio = getRatioFromValue(value);
	const pct = `${ratio * 100}%`;

	const snapElements = useMemo(() => {
		let prevRatio = -1;
		return snaps.map((snap, i) => {
			const r = getRatioFromValue(snap);
			const show = i === 0 || r - prevRatio >= 0.05;
			if (show) prevRatio = r;
			return (
				<span key={snap}>
					<span className="slider-snap" style={{ left: `${r * 100}%` }} />
					<span
						className="slider-xval"
						style={{ left: `${r * 100}%`, display: show ? "block" : "none" }}
					>
						{formatTick ? formatTick(snap) : snap}
					</span>
				</span>
			);
		});
	}, [snaps, getRatioFromValue, formatTick]);

	const tickElements = useMemo(() => {
		let prevRatio = -1;
		return ticks.map((tick) => {
			const r = getRatioFromValue(tick);
			const show = prevRatio < 0 || r - prevRatio >= 0.05;
			if (show) prevRatio = r;
			return (
				<span key={tick}>
					<span className="slider-tick" style={{ left: `${r * 100}%` }} />
					<span
						className="slider-xval"
						style={{ left: `${r * 100}%`, display: show ? "block" : "none" }}
					>
						{formatTick ? formatTick(tick) : tick}
					</span>
				</span>
			);
		});
	}, [ticks, getRatioFromValue, formatTick]);

	const sliderClass = [
		"snappable-slider",
		disabled ? "snappable-slider--disabled" : "",
		altHeld ? "snappable-slider--fine" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			role="slider"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-valuetext={valueText}
			aria-labelledby={labelId}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : 0}
			ref={containerRef}
			className={sliderClass}
			onMouseDown={(e) => {
				if (e.button !== 0) return;
				startDrag(e.clientX, e.altKey);
			}}
			onTouchStart={(e) => startDrag(e.touches[0].clientX, false)}
			onKeyDown={handleKeyDown}
			onKeyUp={handleKeyUp}
			onDoubleClick={handleDoubleClick}
		>
			<span className="slider-track" />
			<span className="slider-fill" style={{ width: pct }} />
			<span className="slider-thumb" style={{ left: pct }} />
			{snapElements}
			{tickElements}
		</div>
	);
}
