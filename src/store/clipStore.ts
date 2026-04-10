import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	buildDefaults,
	type ControlKey,
	DEFAULT_TEMPO,
} from "../audio/controlDefs";

const STORAGE_KEY = "clip-node-state";

export interface ClipControlsState {
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	mins: Record<ControlKey, number>;
	maxs: Record<ControlKey, number>;
	maxLocked: Record<ControlKey, boolean>;
	loop: boolean;
	tempo: number;

	setValue: (key: ControlKey, val: number) => void;
	setSnap: (key: ControlKey, snap: string) => void;
	setEnabled: (key: ControlKey, on: boolean) => void;
	setMin: (key: ControlKey, val: number) => void;
	setMax: (key: ControlKey, val: number) => void;
	setMaxLocked: (key: ControlKey, locked: boolean) => void;
	setLoop: (checked: boolean) => void;
	setTempo: (tempo: number) => void;
	setValues: (values: Record<ControlKey, number>) => void;
}

function searchParamsIncludes(key: string) {
	return (
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).has(key)
	);
}

const defaults = buildDefaults();

export const useClipControls = create<ClipControlsState>()(
	searchParamsIncludes("disable-state")
		? (set) => ({
				...defaults,
				loop: false,
				tempo: DEFAULT_TEMPO,
				setValue: (key, val) =>
					set((s) => ({ values: { ...s.values, [key]: val } })),
				setSnap: (key, snap) =>
					set((s) => ({ snaps: { ...s.snaps, [key]: snap } })),
				setEnabled: (key, on) =>
					set((s) => ({ enabled: { ...s.enabled, [key]: on } })),
				setMin: (key, val) => set((s) => ({ mins: { ...s.mins, [key]: val } })),
				setMax: (key, val) => set((s) => ({ maxs: { ...s.maxs, [key]: val } })),
				setMaxLocked: (key, locked) =>
					set((s) => ({ maxLocked: { ...s.maxLocked, [key]: locked } })),
				setLoop: (checked) => set({ loop: checked }),
				setTempo: (tempo) => set({ tempo }),
				setValues: (values) => set({ values }),
			})
		: persist(
				(set) => ({
					...defaults,
					loop: false,
					tempo: DEFAULT_TEMPO,
					setValue: (key, val) =>
						set((s) => ({ values: { ...s.values, [key]: val } })),
					setSnap: (key, snap) =>
						set((s) => ({ snaps: { ...s.snaps, [key]: snap } })),
					setEnabled: (key, on) =>
						set((s) => ({ enabled: { ...s.enabled, [key]: on } })),
					setMin: (key, val) =>
						set((s) => ({ mins: { ...s.mins, [key]: val } })),
					setMax: (key, val) =>
						set((s) => ({ maxs: { ...s.maxs, [key]: val } })),
					setMaxLocked: (key, locked) =>
						set((s) => ({ maxLocked: { ...s.maxLocked, [key]: locked } })),
					setLoop: (checked) => set({ loop: checked }),
					setTempo: (tempo) => set({ tempo }),
					setValues: (values) => set({ values }),
				}),
				{
					name: STORAGE_KEY,
					partialize: (state) => ({
						values: state.values,
						snaps: state.snaps,
						enabled: state.enabled,
						mins: state.mins,
						maxs: state.maxs,
						maxLocked: state.maxLocked,
						loop: state.loop,
						tempo: state.tempo,
					}),
				},
			),
);
