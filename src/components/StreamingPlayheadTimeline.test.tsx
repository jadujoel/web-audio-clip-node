import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SAMPLE_RATE } from "../controls/controlDefs";
import { StreamingPlayheadTimeline } from "./StreamingPlayheadTimeline";

afterEach(cleanup);

describe("StreamingPlayheadTimeline", () => {
	const noop = () => {};

	test("renders decoded ratio from seekable samples when duration is known", () => {
		const { container } = render(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={10}
				seekableSamples={2 * SAMPLE_RATE}
				streamProgress={0.75}
				onChange={noop}
			/>,
		);

		const track = screen.getByTestId("streaming-playhead-track") as HTMLElement;
		expect(track.getAttribute("data-decoded-percent")).toBe("20");
		expect(track.style.getPropertyValue("--streaming-decoded")).toBe("20%");
		expect(container.querySelector(".slider-track")).toBeTruthy();
	});

	test("falls back to stream progress when duration is unknown", () => {
		render(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={null}
				seekableSamples={2 * SAMPLE_RATE}
				streamProgress={0.4}
				onChange={noop}
			/>,
		);

		const track = screen.getByTestId("streaming-playhead-track") as HTMLElement;
		expect(track.getAttribute("data-decoded-percent")).toBe("40");
		expect(track.style.getPropertyValue("--streaming-decoded")).toBe("40%");
	});

	test("clamps decoded width at 0 and 100 percent", () => {
		const { rerender } = render(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={10}
				seekableSamples={-1}
				streamProgress={0}
				onChange={noop}
			/>,
		);

		let track = screen.getByTestId("streaming-playhead-track") as HTMLElement;
		expect(track.getAttribute("data-decoded-percent")).toBe("0");
		expect(track.style.getPropertyValue("--streaming-decoded")).toBe("0%");

		rerender(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={10}
				seekableSamples={1_000_000}
				streamProgress={0}
				onChange={noop}
			/>,
		);

		track = screen.getByTestId("streaming-playhead-track") as HTMLElement;
		expect(track.getAttribute("data-decoded-percent")).toBe("100");
		expect(track.style.getPropertyValue("--streaming-decoded")).toBe("100%");
	});

	test("disables slider when disabled prop is true", () => {
		const { container } = render(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={10}
				seekableSamples={0}
				streamProgress={0}
				disabled
				onChange={noop}
			/>,
		);

		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-disabled")).toBe("true");
	});

	test("includes decoded percent in slider value text", () => {
		const { container } = render(
			<StreamingPlayheadTimeline
				value={SAMPLE_RATE}
				audioDuration={10}
				seekableSamples={5 * SAMPLE_RATE}
				streamProgress={0}
				onChange={noop}
			/>,
		);

		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-valuetext")).toBe("0:01.00 (decoded 50%)");
	});

	test("floors sample position when changing via keyboard", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<StreamingPlayheadTimeline
				value={0}
				audioDuration={10}
				seekableSamples={2 * SAMPLE_RATE}
				streamProgress={0}
				onChange={onChange}
			/>,
		);

		const slider = container.querySelector("[role='slider']") as HTMLElement;
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalled();
		const calledWith = (onChange.mock.calls[0] as unknown as [number])[0];
		expect(calledWith).toBe(Math.floor(calledWith));
	});
});
