import { useCallback, useEffect, useMemo, useRef } from "react";

export interface SnappableSliderProps {
	min: number;
	max: number;
	value: number;
	skew?: number;
	enableSnap?: boolean;
	snaps?: number[];
	onChange?: (value: number) => void;
}

export function SnappableSlider({
	min,
	max,
	value,
	skew = 1,
	enableSnap = false,
	snaps = [],
	onChange,
}: SnappableSliderProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isDragging = useRef(false);
	const isOptionKeyHeld = useRef(false);

	const getRatioFromValue = useCallback(
		(v: number) => {
			const range = max - min;
			if (range === 0) return 0;
			const normalized = (v - min) / range;
			return skew === 1 ? normalized : Math.max(normalized, 0) ** skew;
		},
		[min, max, skew],
	);

	const getValueFromRatio = useCallback(
		(ratio: number) => {
			const adjusted = skew === 1 ? ratio : ratio ** (1 / skew);
			return adjusted * (max - min) + min;
		},
		[min, max, skew],
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

	const updateFromClientX = useCallback(
		(clientX: number) => {
			const el = containerRef.current;
			if (!el) return;
			const { left, width } = el.getBoundingClientRect();
			const ratio = Math.min(Math.max((clientX - left) / width, 0), 1);
			const raw = getValueFromRatio(ratio);
			const snapped = getSnapped(raw);
			onChange?.(snapped);
		},
		[getValueFromRatio, getSnapped, onChange],
	);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (isDragging.current) updateFromClientX(e.clientX);
		};
		const handleTouchMove = (e: TouchEvent) => {
			if (isDragging.current) updateFromClientX(e.touches[0].clientX);
		};
		const handleUp = () => {
			isDragging.current = false;
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Alt") isOptionKeyHeld.current = true;
		};
		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Alt") isOptionKeyHeld.current = false;
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleUp);
		document.addEventListener("touchmove", handleTouchMove);
		document.addEventListener("touchend", handleUp);
		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("keyup", handleKeyUp);
		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleUp);
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchend", handleUp);
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("keyup", handleKeyUp);
		};
	}, [updateFromClientX]);

	const ratio = getRatioFromValue(value);
	const pct = `${ratio * 100}%`;

	const snapElements = useMemo(() => {
		let prevRatio = -1;
		return snaps.map((snap, i) => {
			const r = getRatioFromValue(snap);
			const show = i === 0 || r - prevRatio >= 0.05;
			if (show) prevRatio = r;
			return (
				<span key={i}>
					<span className="slider-snap" style={{ left: `${r * 100}%` }} />
					<span
						className="slider-xval"
						style={{ left: `${r * 100}%`, display: show ? "block" : "none" }}
					>
						{snap}
					</span>
				</span>
			);
		});
	}, [snaps, getRatioFromValue]);

	return (
		<div
			ref={containerRef}
			className="snappable-slider"
			onMouseDown={(e) => {
				isDragging.current = true;
				updateFromClientX(e.clientX);
			}}
			onTouchStart={(e) => {
				isDragging.current = true;
				updateFromClientX(e.touches[0].clientX);
			}}
		>
			<span className="slider-track" />
			<span className="slider-fill" style={{ width: pct }} />
			<span className="slider-thumb" style={{ left: pct }} />
			{snapElements}
		</div>
	);
}
