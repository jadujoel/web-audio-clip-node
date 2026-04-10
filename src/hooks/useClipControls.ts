import { useCallback, useEffect, useState } from "react";
import { buildDefaults, type ControlKey } from "../audio/controlDefs";

const STORAGE_KEY = "clip-node-state";

interface PersistedState {
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
	mins?: Record<ControlKey, number>;
	maxs?: Record<ControlKey, number>;
	maxLocked?: Record<ControlKey, boolean>;
}

function saveState(state: PersistedState) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(): PersistedState | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PersistedState;
	} catch {
		return null;
	}
}

function searchParamsIncludes(key: string) {
	return new URLSearchParams(window.location.search).has(key);
}

export function useClipControls() {
	const defaults = buildDefaults();
	const disableState = searchParamsIncludes("disable-state");
	const persisted = disableState ? null : loadState();

	const [values, setValues] = useState<Record<ControlKey, number>>(
		persisted?.values ?? defaults.values,
	);
	const [snaps, setSnaps] = useState<Record<ControlKey, string>>(
		persisted?.snaps ?? defaults.snaps,
	);
	const [enabled, setEnabled] = useState<Record<ControlKey, boolean>>(
		persisted?.enabled ?? defaults.enabled,
	);
	const [mins, setMins] = useState<Record<ControlKey, number>>(
		persisted?.mins ?? defaults.mins,
	);
	const [maxs, setMaxs] = useState<Record<ControlKey, number>>(
		persisted?.maxs ?? defaults.maxs,
	);
	const [maxLocked, setMaxLocked] = useState<Record<ControlKey, boolean>>(
		persisted?.maxLocked ?? ({} as Record<ControlKey, boolean>),
	);
	const [loop, setLoop] = useState(false);

	// Save state on unload
	useEffect(() => {
		if (disableState) return;
		const handler = () =>
			saveState({ values, snaps, enabled, mins, maxs, maxLocked });
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [values, snaps, enabled, mins, maxs, maxLocked, disableState]);

	const setValue = useCallback((key: ControlKey, val: number) => {
		setValues((prev) => ({ ...prev, [key]: val }));
	}, []);

	const setSnap = useCallback((key: ControlKey, snap: string) => {
		setSnaps((prev) => ({ ...prev, [key]: snap }));
	}, []);

	const setEnabledKey = useCallback((key: ControlKey, on: boolean) => {
		setEnabled((prev) => ({ ...prev, [key]: on }));
	}, []);

	const setLoopValue = useCallback((checked: boolean) => {
		setLoop(checked);
	}, []);

	const setMinKey = useCallback((key: ControlKey, val: number) => {
		setMins((prev) => ({ ...prev, [key]: val }));
	}, []);

	const setMaxKey = useCallback((key: ControlKey, val: number) => {
		setMaxs((prev) => ({ ...prev, [key]: val }));
	}, []);

	const setMaxLockedKey = useCallback((key: ControlKey, locked: boolean) => {
		setMaxLocked((prev) => ({ ...prev, [key]: locked }));
	}, []);

	return {
		values,
		snaps,
		enabled,
		mins,
		maxs,
		maxLocked,
		loop,
		setValue,
		setSnap,
		setEnabled: setEnabledKey,
		setMin: setMinKey,
		setMax: setMaxKey,
		setMaxLocked: setMaxLockedKey,
		setLoop: setLoopValue,
		setValues,
	};
}
