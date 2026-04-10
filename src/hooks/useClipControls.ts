import { useCallback, useEffect, useState } from "react";
import { buildDefaults, type ControlKey } from "../audio/controlDefs";

const STORAGE_KEY = "clip-node-state";

interface PersistedState {
	values: Record<ControlKey, number>;
	snaps: Record<ControlKey, string>;
	enabled: Record<ControlKey, boolean>;
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
	const [loop, setLoop] = useState(false);

	// Save state on unload
	useEffect(() => {
		if (disableState) return;
		const handler = () => saveState({ values, snaps, enabled });
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [values, snaps, enabled, disableState]);

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

	return {
		values,
		snaps,
		enabled,
		loop,
		setValue,
		setSnap,
		setEnabled: setEnabledKey,
		setLoop: setLoopValue,
		setValues,
	};
}
