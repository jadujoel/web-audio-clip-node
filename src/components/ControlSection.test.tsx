import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ControlDef, ControlKey } from "../audio/controlDefs";
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

describe("ControlSection", () => {
	test("renders a fieldset with legend", () => {
		const { container } = render(
			<ControlSection
				legend="Test Section"
				defs={testDefs}
				values={makeValues()}
				snaps={makeSnaps()}
				enabled={makeEnabled()}
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
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
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={() => {}}
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
				onValueChange={onValueChange}
				onToggle={() => {}}
				onSnapChange={() => {}}
			/>,
		);
		// Find the first slider and change it
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
				onValueChange={() => {}}
				onToggle={onToggle}
				onSnapChange={() => {}}
			/>,
		);
		const toggle = container.querySelector(".control-toggle");
		expect(toggle).toBeTruthy();
		if (!toggle) throw new Error("toggle not found");
		fireEvent.click(toggle);
		expect(onToggle).toHaveBeenCalled();
	});

	test("onSnapChange is called when snap changes", () => {
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
				onValueChange={() => {}}
				onToggle={() => {}}
				onSnapChange={onSnapChange}
			/>,
		);
		const select = container.querySelector(".control-snap");
		expect(select).toBeTruthy();
		if (!select) throw new Error("select not found");
		fireEvent.change(select, { target: { value: "beat" } });
		expect(onSnapChange).toHaveBeenCalled();
	});
});
