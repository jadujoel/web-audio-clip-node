import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LoopMode } from "../audio/types";
import {
	buildDefaults,
	type ControlKey,
	DEFAULT_TEMPO,
} from "../controls/controlDefs";
import {
	buildLinkedControlPairDefaults,
	type LinkedControlPairKey,
} from "../controls/linkedControlPairs";

const STORAGE_KEY = "clip-node-state";

export interface ClipControlsState {
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	mins: Record<ControlKey, number>;
	maxs: Record<ControlKey, number>;
	maxLocked: Record<ControlKey, boolean>;
	linkedPairs: Record<LinkedControlPairKey, boolean>;
	loop: boolean;
	loopMode: LoopMode;
	tempo: number;

	setValue: (key: ControlKey, val: number) => void;
	setValuesPartial: (values: Partial<Record<ControlKey, number>>) => void;
	setSnap: (key: ControlKey, snap: string) => void;
	setSnapsPartial: (snaps: Partial<Record<ControlKey, string>>) => void;
	setEnabled: (key: ControlKey, on: boolean) => void;
	setEnabledPartial: (enabled: Partial<Record<ControlKey, boolean>>) => void;
	setMin: (key: ControlKey, val: number) => void;
	setMinsPartial: (mins: Partial<Record<ControlKey, number>>) => void;
	setMax: (key: ControlKey, val: number) => void;
	setMaxsPartial: (maxs: Partial<Record<ControlKey, number>>) => void;
	setMaxLocked: (key: ControlKey, locked: boolean) => void;
	setMaxLockedPartial: (
		maxLocked: Partial<Record<ControlKey, boolean>>,
	) => void;
	setLinkedPair: (key: LinkedControlPairKey, on: boolean) => void;
	setLoop: (checked: boolean) => void;
	setLoopMode: (mode: LoopMode) => void;
	setTempo: (tempo: number) => void;
	setTempoAndValues: (
		tempo: number,
		values: Partial<Record<ControlKey, number>>,
	) => void;
	setValues: (values: Record<ControlKey, number>) => void;
}

function searchParamsIncludes(key: string) {
	return (
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).has(key)
	);
}

const defaults = buildDefaults();
const linkedPairDefaults = buildLinkedControlPairDefaults();

export const useClipControls = create<ClipControlsState>()(
	searchParamsIncludes("disable-state")
		? (set) => ({
				...defaults,
				linkedPairs: linkedPairDefaults,
				loop: false,
				loopMode: "forward" as LoopMode,
				tempo: DEFAULT_TEMPO,
				setValue: (key, val) =>
					set((s) => ({ values: { ...s.values, [key]: val } })),
				setValuesPartial: (values) =>
					set((s) => ({ values: { ...s.values, ...values } })),
				setSnap: (key, snap) =>
					set((s) => ({ snaps: { ...s.snaps, [key]: snap } })),
				setSnapsPartial: (snaps) =>
					set((s) => ({ snaps: { ...s.snaps, ...snaps } })),
				setEnabled: (key, on) =>
					set((s) => ({ enabled: { ...s.enabled, [key]: on } })),
				setEnabledPartial: (enabled) =>
					set((s) => ({ enabled: { ...s.enabled, ...enabled } })),
				setMin: (key, val) => set((s) => ({ mins: { ...s.mins, [key]: val } })),
				setMinsPartial: (mins) =>
					set((s) => ({ mins: { ...s.mins, ...mins } })),
				setMax: (key, val) => set((s) => ({ maxs: { ...s.maxs, [key]: val } })),
				setMaxsPartial: (maxs) =>
					set((s) => ({ maxs: { ...s.maxs, ...maxs } })),
				setMaxLocked: (key, locked) =>
					set((s) => ({ maxLocked: { ...s.maxLocked, [key]: locked } })),
				setMaxLockedPartial: (maxLocked) =>
					set((s) => ({ maxLocked: { ...s.maxLocked, ...maxLocked } })),
				setLinkedPair: (key, on) =>
					set((s) => ({ linkedPairs: { ...s.linkedPairs, [key]: on } })),
				setLoop: (checked) => set({ loop: checked }),
				setLoopMode: (mode) => set({ loopMode: mode }),
				setTempo: (tempo) => set({ tempo }),
				setTempoAndValues: (tempo, values) =>
					set((s) => ({ tempo, values: { ...s.values, ...values } })),
				setValues: (values) => set({ values }),
			})
		: persist(
				(set) => ({
					...defaults,
					linkedPairs: linkedPairDefaults,
					loop: false,
					loopMode: "forward" as LoopMode,
					tempo: DEFAULT_TEMPO,
					setValue: (key, val) =>
						set((s) => ({ values: { ...s.values, [key]: val } })),
					setValuesPartial: (values) =>
						set((s) => ({ values: { ...s.values, ...values } })),
					setSnap: (key, snap) =>
						set((s) => ({ snaps: { ...s.snaps, [key]: snap } })),
					setSnapsPartial: (snaps) =>
						set((s) => ({ snaps: { ...s.snaps, ...snaps } })),
					setEnabled: (key, on) =>
						set((s) => ({ enabled: { ...s.enabled, [key]: on } })),
					setEnabledPartial: (enabled) =>
						set((s) => ({ enabled: { ...s.enabled, ...enabled } })),
					setMin: (key, val) =>
						set((s) => ({ mins: { ...s.mins, [key]: val } })),
					setMinsPartial: (mins) =>
						set((s) => ({ mins: { ...s.mins, ...mins } })),
					setMax: (key, val) =>
						set((s) => ({ maxs: { ...s.maxs, [key]: val } })),
					setMaxsPartial: (maxs) =>
						set((s) => ({ maxs: { ...s.maxs, ...maxs } })),
					setMaxLocked: (key, locked) =>
						set((s) => ({ maxLocked: { ...s.maxLocked, [key]: locked } })),
					setMaxLockedPartial: (maxLocked) =>
						set((s) => ({ maxLocked: { ...s.maxLocked, ...maxLocked } })),
					setLinkedPair: (key, on) =>
						set((s) => ({ linkedPairs: { ...s.linkedPairs, [key]: on } })),
					setLoop: (checked) => set({ loop: checked }),
					setLoopMode: (mode) => set({ loopMode: mode }),
					setTempo: (tempo) => set({ tempo }),
					setTempoAndValues: (tempo, values) =>
						set((s) => ({ tempo, values: { ...s.values, ...values } })),
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
						linkedPairs: state.linkedPairs,
						loop: state.loop,
						loopMode: state.loopMode,
						tempo: state.tempo,
					}),
					merge: (persisted, current) => {
						const p = persisted as Partial<ClipControlsState> | undefined;
						if (!p) return current;
						return {
							...current,
							...p,
							values: { ...current.values, ...p.values },
							snaps: { ...current.snaps, ...p.snaps },
							enabled: { ...current.enabled, ...p.enabled },
							mins: { ...current.mins, ...p.mins },
							maxs: { ...current.maxs, ...p.maxs },
							maxLocked: { ...current.maxLocked, ...p.maxLocked },
							linkedPairs: { ...current.linkedPairs, ...p.linkedPairs },
						};
					},
				},
			),
);
