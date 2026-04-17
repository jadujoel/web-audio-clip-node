import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	buildDefaults,
	DEFAULT_MAX_8_BARS,
	DEFAULT_TEMPO,
} from "./controls/controlDefs";
import { buildLinkedControlPairDefaults } from "./controls/linkedControlPairs";
import { useClipControls } from "./store/clipStore";

type UseClipNodeImpl = typeof import("./hooks/useClipNode").useClipNode;

const applyValueMock = vi.fn(() => {});
const applyValuesMock = vi.fn(() => {});
const applyToggleMock = vi.fn(() => {});
const setLoopOnNodeMock = vi.fn(() => {});
const setLoopModeOnNodeMock = vi.fn(() => {});

const cacheMatchMock = vi.fn(async () => undefined);
const cachePutMock = vi.fn(async () => undefined);

if (!("caches" in globalThis)) {
	globalThis.caches = {
		open: vi.fn(
			async () =>
				({
					match: cacheMatchMock,
					put: cachePutMock,
				}) as unknown as Cache,
		) as unknown as CacheStorage["open"],
	} as unknown as CacheStorage;
}

const { App } = await import("./App");

const useClipNodeStub: UseClipNodeImpl = () => {
	return {
		nodeState: "initial" as const,
		statusMessage: null,
		soundName: null,
		audioDuration: null,
		infoCurrentTime: "0",
		infoCurrentFrame: "0",
		infoTimesLooped: "0",
		infoLatency: "unknown",
		infoTimeTaken: "unknown",
		start: vi.fn(async () => undefined),
		stop: vi.fn(() => {}),
		pause: vi.fn(() => {}),
		resume: vi.fn(() => {}),
		dispose: vi.fn(() => {}),
		logState: vi.fn(() => {}),
		loadSound: vi.fn(() => {}),
		applyValue: applyValueMock,
		applyValues: applyValuesMock,
		applyToggle: applyToggleMock,
		setLoopOnNode: setLoopOnNodeMock,
		setLoopModeOnNode: setLoopModeOnNodeMock,
		audioContext: null,
		outputNode: null,
	};
};

function getAudioControl(label: string): HTMLElement {
	const labels = Array.from(
		document.querySelectorAll<HTMLElement>(".control-label"),
	);
	const labelElement = labels.find((element) => element.textContent === label);
	if (!labelElement) {
		throw new Error(`Audio control not found: ${label}`);
	}

	const control = labelElement.closest<HTMLElement>(".audio-control");
	if (!control) {
		throw new Error(`Audio control container not found: ${label}`);
	}

	return control;
}

function getControlToggle(label: string): HTMLInputElement {
	const toggle =
		getAudioControl(label).querySelector<HTMLInputElement>(".control-toggle");
	if (!toggle) {
		throw new Error(`Toggle not found for: ${label}`);
	}

	return toggle;
}

function resetControls() {
	const defaults = buildDefaults();
	useClipControls.setState({
		values: defaults.values,
		snaps: defaults.snaps,
		enabled: defaults.enabled,
		mins: defaults.mins,
		maxs: defaults.maxs,
		maxLocked: defaults.maxLocked,
		linkedPairs: buildLinkedControlPairDefaults(),
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

	test("changing tempo only commits on blur and preserves snapped beat counts", () => {
		useClipControls.setState((state) => ({
			values: {
				...state.values,
				startDelay: 1.2,
				fadeIn: 0,
				gain: -6,
			},
			snaps: {
				...state.snaps,
				startDelay: "beat",
				fadeIn: "beat",
			},
			tempo: 90,
		}));

		render(<App useClipNodeImpl={useClipNodeStub} />);

		const input = screen.getByLabelText("BPM");
		expect(screen.getByDisplayValue("90")).toBeTruthy();
		expect(screen.getByRole("button", { name: "2 beats" })).toBeTruthy();

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "1" } });
		expect(useClipControls.getState().tempo).toBe(90);
		expect(applyValuesMock).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "12" } });
		expect(useClipControls.getState().tempo).toBe(90);
		expect(applyValuesMock).not.toHaveBeenCalled();

		fireEvent.change(input, { target: { value: "120" } });
		expect(useClipControls.getState().tempo).toBe(90);
		expect(applyValuesMock).not.toHaveBeenCalled();

		fireEvent.blur(input);

		const state = useClipControls.getState();
		expect(state.tempo).toBe(120);
		expect(state.values.startDelay).toBe(1);
		expect(state.values.fadeIn).toBe(0);
		expect(state.values.gain).toBe(-6);
		expect(screen.getByRole("button", { name: "2 beats" })).toBeTruthy();
		expect(applyValuesMock).toHaveBeenCalledWith({ startDelay: 1 });
	});

	test("pressing Enter commits the tempo draft", () => {
		useClipControls.setState((state) => ({
			values: {
				...state.values,
				startDelay: 1,
			},
			snaps: {
				...state.snaps,
				startDelay: "beat",
			},
			tempo: 120,
		}));

		render(<App useClipNodeImpl={useClipNodeStub} />);

		const input = screen.getByLabelText("BPM");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "60" } });

		expect(useClipControls.getState().tempo).toBe(120);
		expect(applyValuesMock).not.toHaveBeenCalled();

		fireEvent.keyDown(input, { key: "Enter" });

		const state = useClipControls.getState();
		expect(state.tempo).toBe(60);
		expect(state.values.startDelay).toBe(2);
		expect(screen.getByDisplayValue("60")).toBeTruthy();
		expect(applyValuesMock).toHaveBeenCalledWith({ startDelay: 2 });
	});

	test("linked stopDelay and fadeOut move together", () => {
		useClipControls.setState((state) => ({
			values: {
				...state.values,
				stopDelay: 1,
				fadeOut: 3,
			},
			snaps: {
				...state.snaps,
				stopDelay: "none",
				fadeOut: "none",
			},
		}));

		render(<App useClipNodeImpl={useClipNodeStub} />);

		fireEvent.click(screen.getByLabelText("Link StopDelay and FadeOut"));
		fireEvent.keyDown(screen.getByRole("slider", { name: "StopDelay" }), {
			key: "ArrowRight",
		});

		const state = useClipControls.getState();
		const step = DEFAULT_MAX_8_BARS / 100;
		expect(state.linkedPairs.fadeOutStopDelay).toBe(true);
		expect(state.values.stopDelay).toBeCloseTo(1 + step, 5);
		expect(state.values.fadeOut).toBeCloseTo(3 + step, 5);
		expect(applyValuesMock).toHaveBeenCalledWith({
			stopDelay: 1 + step,
			fadeOut: 3 + step,
		});
	});

	test("linked loop start and end keep their gap at the boundary", () => {
		useClipControls.setState((state) => ({
			values: {
				...state.values,
				loopStart: 3,
				loopEnd: 5,
			},
			snaps: {
				...state.snaps,
				loopStart: "none",
				loopEnd: "none",
			},
			maxs: {
				...state.maxs,
				loopStart: 6,
				loopEnd: 6,
			},
			maxLocked: {
				...state.maxLocked,
				loopStart: false,
				loopEnd: false,
			},
			loop: true,
		}));

		render(<App useClipNodeImpl={useClipNodeStub} />);

		fireEvent.click(screen.getByLabelText("Link Start and End"));

		const endSlider = screen.getByRole("slider", {
			name: "End",
		}) as HTMLElement;
		endSlider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 100,
				top: 0,
				right: 100,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}) as DOMRect;

		fireEvent.mouseDown(endSlider, { button: 0, clientX: 100 });
		fireEvent.mouseUp(document);

		const state = useClipControls.getState();
		expect(state.linkedPairs.loopStartEnd).toBe(true);
		expect(state.values.loopStart).toBe(4);
		expect(state.values.loopEnd).toBe(6);
		expect(applyValuesMock).toHaveBeenCalledWith({ loopEnd: 6, loopStart: 4 });
	});

	test("linked stopDelay and fadeOut share snap selection", () => {
		useClipControls.setState((state) => ({
			snaps: {
				...state.snaps,
				stopDelay: "none",
				fadeOut: "none",
			},
		}));

		render(<App useClipNodeImpl={useClipNodeStub} />);

		fireEvent.click(screen.getByLabelText("Link StopDelay and FadeOut"));
		fireEvent.contextMenu(getAudioControl("StopDelay"), {
			clientX: 200,
			clientY: 200,
		});
		fireEvent.click(screen.getByRole("menuitemradio", { name: /Bar/i }));

		const state = useClipControls.getState();
		expect(state.snaps.stopDelay).toBe("bar");
		expect(state.snaps.fadeOut).toBe("bar");
	});

	test("linked stopDelay and fadeOut share range and toggle state", () => {
		render(<App useClipNodeImpl={useClipNodeStub} />);

		fireEvent.click(screen.getByLabelText("Link StopDelay and FadeOut"));
		fireEvent.contextMenu(getAudioControl("StopDelay"), {
			clientX: 200,
			clientY: 200,
		});

		const minInput = screen.getByLabelText("Min:");
		fireEvent.change(minInput, { target: { value: "0.5" } });
		fireEvent.blur(minInput);

		const maxInput = screen.getByLabelText("Max:");
		fireEvent.change(maxInput, { target: { value: "2.5" } });
		fireEvent.blur(maxInput);

		fireEvent.click(getControlToggle("StopDelay"));

		const state = useClipControls.getState();
		expect(state.mins.stopDelay).toBe(0.5);
		expect(state.mins.fadeOut).toBe(0.5);
		expect(state.maxs.stopDelay).toBe(2.5);
		expect(state.maxs.fadeOut).toBe(2.5);
		expect(state.enabled.stopDelay).toBe(false);
		expect(state.enabled.fadeOut).toBe(false);
		expect(applyToggleMock).toHaveBeenNthCalledWith(1, "stopDelay", false);
		expect(applyToggleMock).toHaveBeenNthCalledWith(2, "fadeOut", false);
	});
});
