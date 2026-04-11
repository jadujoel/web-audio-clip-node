import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildDefaults, DEFAULT_TEMPO } from "./controls/controlDefs";
import { useClipControls } from "./store/clipStore";

const applyValueMock = mock(() => {});
const applyValuesMock = mock(() => {});
const applyToggleMock = mock(() => {});
const setLoopOnNodeMock = mock(() => {});

mock.module("./hooks/useClipNode", () => ({
	useClipNode: () => ({
		nodeState: "initial",
		statusMessage: null,
		soundName: null,
		audioDuration: null,
		infoCurrentTime: "0",
		infoCurrentFrame: "0",
		infoTimesLooped: "0",
		infoLatency: "unknown",
		infoTimeTaken: "unknown",
		start: mock(() => {}),
		stop: mock(() => {}),
		pause: mock(() => {}),
		resume: mock(() => {}),
		dispose: mock(() => {}),
		logState: mock(() => {}),
		loadSound: mock(() => {}),
		applyValue: applyValueMock,
		applyValues: applyValuesMock,
		applyToggle: applyToggleMock,
		setLoopOnNode: setLoopOnNodeMock,
	}),
}));

const { App } = await import("./App");

function resetControls() {
	const defaults = buildDefaults();
	useClipControls.setState({
		values: defaults.values,
		snaps: defaults.snaps,
		enabled: defaults.enabled,
		mins: defaults.mins,
		maxs: defaults.maxs,
		maxLocked: defaults.maxLocked,
		loop: false,
		tempo: DEFAULT_TEMPO,
	});
}

describe("App tempo resync", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetControls();
		applyValueMock.mockClear();
		applyValuesMock.mockClear();
		applyToggleMock.mockClear();
		setLoopOnNodeMock.mockClear();
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		resetControls();
	});

	test("changing tempo preserves snapped beat counts and syncs changed values", () => {
		useClipControls.setState((state) => ({
			values: {
				...state.values,
				startDelay: 1,
				fadeIn: 0,
				gain: -6,
			},
			snaps: {
				...state.snaps,
				startDelay: "beat",
				fadeIn: "beat",
			},
			tempo: 120,
		}));

		render(<App />);

		expect(screen.getByDisplayValue("120")).toBeTruthy();
		expect(screen.getByRole("button", { name: "2 beats" })).toBeTruthy();

		fireEvent.change(screen.getByLabelText("BPM"), {
			target: { value: "60" },
		});

		const state = useClipControls.getState();
		expect(state.tempo).toBe(60);
		expect(state.values.startDelay).toBe(2);
		expect(state.values.fadeIn).toBe(0);
		expect(state.values.gain).toBe(-6);
		expect(screen.getByRole("button", { name: "2 beats" })).toBeTruthy();
		expect(applyValuesMock).toHaveBeenCalledWith({ startDelay: 2 });
	});
});
