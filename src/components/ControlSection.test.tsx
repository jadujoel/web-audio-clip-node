import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ControlDef, ControlKey } from "../controls/controlDefs";
import { ControlSection } from "./ControlSection";

afterEach(cleanup);

const testDefs: ControlDef[] = [
	{
		key: "gain",
		label: "Gain",
		min: -100,
		max: 0,
		defaultValue: 0,
		preset: "gain",
		hasToggle: true,
	},
	{
		key: "pan",
		label: "Pan",
		min: -1,
		max: 1,
		defaultValue: 0,
		preset: "pan",
		hasToggle: true,
	},
];

function makeValues(): Record<ControlKey, number> {
	return {
		playhead: 0,
		offset: 0,
		duration: -1,
		startDelay: 0,
		stopDelay: 0,
		fadeIn: 0,
		fadeOut: 0,
		loopStart: 0,
		loopEnd: 0,
		loopCrossfade: 0,
		playbackRate: 1,
		detune: 0,
		gain: 0,
		pan: 0,
		lowpass: 16384,
		highpass: 32,
	};
}

function makeSnaps(): Record<ControlKey, string> {
	return {
		playhead: "none",
		offset: "none",
		duration: "none",
		startDelay: "none",
		stopDelay: "none",
		fadeIn: "none",
		fadeOut: "none",
		loopStart: "none",
		loopEnd: "none",
		loopCrossfade: "none",
		playbackRate: "none",
		detune: "none",
		gain: "none",
		pan: "none",
		lowpass: "none",
		highpass: "none",
	};
}

function makeEnabled(): Record<ControlKey, boolean> {
	return {
		playhead: true,
		offset: true,
		duration: true,
		startDelay: true,
		stopDelay: true,
		fadeIn: true,
		fadeOut: true,
		loopStart: true,
		loopEnd: true,
		loopCrossfade: true,
		playbackRate: true,
		detune: true,
		gain: true,
		pan: true,
		lowpass: true,
		highpass: true,
	};
}

function makeMins(): Record<ControlKey, number> {
	return {
		playhead: 0,
		offset: 0,
		duration: -1,
		startDelay: 0,
		stopDelay: 0,
		fadeIn: 0,
		fadeOut: 0,
		loopStart: 0,
		loopEnd: 0,
		loopCrossfade: 0,
		playbackRate: -2,
		detune: -2400,
		gain: -100,
		pan: -1,
		lowpass: 32,
		highpass: 32,
	};
}

function makeMaxs(): Record<ControlKey, number> {
	return {
		playhead: 480000,
		offset: 4,
		duration: 40,
		startDelay: 4,
		stopDelay: 4,
		fadeIn: 4,
		fadeOut: 4,
		loopStart: 1,
		loopEnd: 1,
		loopCrossfade: 1,
		playbackRate: 2,
		detune: 2400,
		gain: 0,
		pan: 1,
		lowpass: 16384,
		highpass: 16384,
	};
}

function makeMaxLocked(): Record<ControlKey, boolean> {
	return {
		playhead: false,
		offset: false,
		duration: false,
		startDelay: false,
		stopDelay: false,
		fadeIn: false,
		fadeOut: false,
		loopStart: false,
		loopEnd: false,
		loopCrossfade: false,
		playbackRate: false,
		detune: false,
		gain: false,
		pan: false,
		lowpass: false,
		highpass: false,
	};
}

describe("ControlSection", () => {
	test("renders a fieldset with legend", () => {
		const { container } = render(
			<ControlSection
				legend="Test Section"
				defs={testDefs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={makeMaxs()}
				maxLocked={makeMaxLocked()}
				tempo={120}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const legend = container.querySelector("legend");
		expect(legend?.textContent).toBe("Test Section");
	});

	test("renders AudioControl for each def", () => {
		const { container } = render(
			<ControlSection
				legend="Params"
				defs={testDefs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={makeMaxs()}
				maxLocked={makeMaxLocked()}
				tempo={120}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const labels = container.querySelectorAll(".control-label");
		expect(labels.length).toBe(2);
		expect(labels[0].textContent).toBe("Gain");
		expect(labels[1].textContent).toBe("Pan");
	});

	test("onValueChange is called with correct key", () => {
		const onValueChange = mock(() => {});
		const { container } = render(
			<ControlSection
				legend="Params"
				defs={testDefs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={makeMaxs()}
				maxLocked={makeMaxLocked()}
				tempo={120}
				onValueChange={onValueChange}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const slider = container.querySelector('[role="slider"]');
		expect(slider).toBeTruthy();
		if (!slider) throw new Error("slider not found");
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onValueChange).toHaveBeenCalled();
		const firstCall = onValueChange.mock.calls[0] as unknown[];
		expect(firstCall[0]).toBe("gain");
	});

	test("onToggle is called when toggle changes", () => {
		const onToggle = mock(() => {});
		const { container } = render(
			<ControlSection
				legend="Params"
				defs={testDefs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={makeMaxs()}
				maxLocked={makeMaxLocked()}
				tempo={120}
				onValueChange={() => {}}
				onToggle={onToggle}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const toggle = container.querySelector(".control-toggle");
		expect(toggle).toBeTruthy();
		if (!toggle) throw new Error("toggle not found");
		fireEvent.click(toggle);
		expect(onToggle).toHaveBeenCalled();
	});

	test("uses audioDuration as max when maxLocked is true", () => {
		const defs: ControlDef[] = [
			{
				key: "offset",
				label: "Offset",
				min: 0,
				max: 4,
				defaultValue: 0,
				hasSnap: true,
			},
		];
		const maxs = makeMaxs();
		maxs.offset = 4; // default max
		const maxLocked = makeMaxLocked();
		maxLocked.offset = true;
		const audioDuration = 10;

		const { container } = render(
			<ControlSection
				legend="Transport"
				defs={defs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={maxs}
				maxLocked={maxLocked}
				tempo={120}
				audioDuration={audioDuration}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const slider = container.querySelector('[role="slider"]');
		expect(slider).toBeTruthy();
		// aria-valuemax should reflect audioDuration, not the default maxs value
		expect(slider?.getAttribute("aria-valuemax")).toBe(String(audioDuration));
	});

	test("falls back to maxs when maxLocked is false", () => {
		const defs: ControlDef[] = [
			{
				key: "offset",
				label: "Offset",
				min: 0,
				max: 4,
				defaultValue: 0,
				hasSnap: true,
			},
		];
		const maxs = makeMaxs();
		maxs.offset = 8;
		const maxLocked = makeMaxLocked();
		maxLocked.offset = false;

		const { container } = render(
			<ControlSection
				legend="Transport"
				defs={defs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={maxs}
				maxLocked={maxLocked}
				tempo={120}
				audioDuration={10}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const slider = container.querySelector('[role="slider"]');
		expect(slider).toBeTruthy();
		// Should use maxs value, not audioDuration
		expect(slider?.getAttribute("aria-valuemax")).toBe("8");
	});

	test("falls back to maxs when audioDuration is null", () => {
		const defs: ControlDef[] = [
			{
				key: "offset",
				label: "Offset",
				min: 0,
				max: 4,
				defaultValue: 0,
				hasSnap: true,
			},
		];
		const maxs = makeMaxs();
		maxs.offset = 4;
		const maxLocked = makeMaxLocked();
		maxLocked.offset = true;

		const { container } = render(
			<ControlSection
				legend="Transport"
				defs={defs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={maxs}
				maxLocked={maxLocked}
				tempo={120}
				audioDuration={null}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const slider = container.querySelector('[role="slider"]');
		expect(slider).toBeTruthy();
		// Should use maxs value since no audio is loaded
		expect(slider?.getAttribute("aria-valuemax")).toBe("4");
	});

	test("onSnapChange is called via context menu", () => {
		const onSnapChange = mock(() => {});
		const defsWithSnap: ControlDef[] = [
			{
				key: "offset",
				label: "Offset",
				min: 0,
				max: 4,
				defaultValue: 0,
				hasSnap: true,
			},
		];
		const { container } = render(
			<ControlSection
				legend="Params"
				defs={defsWithSnap}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				mins={makeMins()}
				maxs={makeMaxs()}
				maxLocked={makeMaxLocked()}
				tempo={120}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={onSnapChange}
				onMinChange={() => {}}
				onMaxChange={() => {}}
				onMaxLockedChange={() => {}}
			/>,
		);
		const control = container.querySelector(".audio-control");
		expect(control).toBeTruthy();
		if (!control) throw new Error("control not found");
		fireEvent.contextMenu(control, { clientX: 200, clientY: 200 });
		const items = document.querySelectorAll('[role="menuitemradio"]');
		expect(items.length).toBeGreaterThan(0);
		fireEvent.click(items[1]); // Beat
		expect(onSnapChange).toHaveBeenCalled();
	});
});
