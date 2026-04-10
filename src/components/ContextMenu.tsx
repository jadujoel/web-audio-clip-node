import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuProps {
	x: number;
	y: number;
	snap: string;
	snapMode?: "tempo" | "preset";
	min: number;
	max: number;
	maxLocked?: boolean;
	showMaxLock?: boolean;
	audioDuration: number | null;
	onSnapChange: (snap: string) => void;
	onMinChange: (val: number) => void;
	onMaxChange: (val: number) => void;
	onMaxLockedChange?: (locked: boolean) => void;
	onClose: () => void;
}

const SNAP_OPTIONS = [
	{ value: "none", label: "None" },
	{ value: "beat", label: "Beat" },
	{ value: "bar", label: "Bar" },
	{ value: "8th", label: "8th" },
	{ value: "16th", label: "16th" },
	{ value: "int", label: "Integer" },
];

export function ContextMenu({
	x,
	y,
	snap,
	snapMode = "tempo",
	min,
	max,
	maxLocked = false,
	showMaxLock = true,
	audioDuration,
	onSnapChange,
	onMinChange,
	onMaxChange,
	onMaxLockedChange,
	onClose,
}: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on click outside or Escape
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [onClose]);

	// Adjust position to stay within viewport
	useEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.right > window.innerWidth) {
			el.style.left = `${window.innerWidth - rect.width - 8}px`;
		}
		if (rect.bottom > window.innerHeight) {
			el.style.top = `${window.innerHeight - rect.height - 8}px`;
		}
	}, []);

	const handleSnapClick = useCallback(
		(value: string) => {
			onSnapChange(value);
		},
		[onSnapChange],
	);

	const handleMinCommit = useCallback(
		(
			e:
				| React.FocusEvent<HTMLInputElement>
				| React.KeyboardEvent<HTMLInputElement>,
		) => {
			const input = e.currentTarget;
			const parsed = Number.parseFloat(input.value);
			if (Number.isFinite(parsed)) {
				onMinChange(parsed);
			}
		},
		[onMinChange],
	);

	const handleMaxCommit = useCallback(
		(
			e:
				| React.FocusEvent<HTMLInputElement>
				| React.KeyboardEvent<HTMLInputElement>,
		) => {
			const input = e.currentTarget;
			const parsed = Number.parseFloat(input.value);
			if (Number.isFinite(parsed)) {
				onMaxChange(parsed);
			}
		},
		[onMaxChange],
	);

	const handleInputKeyDown = useCallback(
		(commit: (e: React.KeyboardEvent<HTMLInputElement>) => void) =>
			(e: React.KeyboardEvent<HTMLInputElement>) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commit(e);
				} else if (e.key === "Escape") {
					e.preventDefault();
					onClose();
				}
			},
		[onClose],
	);

	return createPortal(
		<div
			ref={menuRef}
			className="context-menu"
			style={{ left: x, top: y }}
			role="menu"
		>
			<div className="context-menu__section-label">Snap</div>
			{snapMode === "preset" ? (
				<label className="context-menu__field">
					<input
						type="checkbox"
						className="control-toggle"
						checked={snap !== "none"}
						onChange={(e) => onSnapChange(e.target.checked ? "preset" : "none")}
					/>
					Enable snap
				</label>
			) : (
				SNAP_OPTIONS.map((opt) => (
					<button
						key={opt.value}
						type="button"
						className={`context-menu__item${snap === opt.value ? " context-menu__item--active" : ""}`}
						role="menuitemradio"
						aria-checked={snap === opt.value}
						onClick={() => handleSnapClick(opt.value)}
					>
						<span className="context-menu__radio">
							{snap === opt.value ? "●" : "○"}
						</span>
						{opt.label}
					</button>
				))
			)}
			<div className="context-menu__divider" />
			<div className="context-menu__section-label">Range</div>
			<label className="context-menu__field">
				Min:
				<input
					type="number"
					className="context-menu__input"
					defaultValue={min}
					step="any"
					onBlur={handleMinCommit}
					onKeyDown={handleInputKeyDown(handleMinCommit)}
				/>
			</label>
			<label className="context-menu__field">
				Max:
				<input
					type="number"
					className="context-menu__input"
					defaultValue={max}
					step="any"
					disabled={maxLocked && audioDuration != null}
					onBlur={handleMaxCommit}
					onKeyDown={handleInputKeyDown(handleMaxCommit)}
				/>
			</label>
			{showMaxLock && (
				<label className="context-menu__field">
					<input
						type="checkbox"
						className="control-toggle"
						checked={maxLocked}
						onChange={(e) => onMaxLockedChange?.(e.target.checked)}
					/>
					Max = file length
				</label>
			)}
		</div>,
		document.body,
	);
}
