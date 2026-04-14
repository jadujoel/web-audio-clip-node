import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlayheadSlider } from "./PlayheadSlider";

afterEach(cleanup);

const SAMPLE_RATE = 48000;

describe("PlayheadSlider", () => {
	const noop = () => {};

	test("renders label and time display", () => {
		render(<PlayheadSlider value={0} audioDuration={10} onChange={noop} />);
		expect(screen.getByText("Playhead")).toBeTruthy();
		expect(screen.getByText("0:00.00 / 0:10.00")).toBeTruthy();
	});

	test("displays correct time for non-zero playhead", () => {
		const samplePos = 3.5 * SAMPLE_RATE; // 3.5 seconds
		render(
			<PlayheadSlider value={samplePos} audioDuration={10} onChange={noop} />,
		);
		expect(screen.getByText("0:03.50 / 0:10.00")).toBeTruthy();
	});

	test("displays minute values correctly", () => {
		const samplePos = 65 * SAMPLE_RATE; // 1 minute 5 seconds
		render(
			<PlayheadSlider value={samplePos} audioDuration={120} onChange={noop} />,
		);
		expect(screen.getByText("1:05.00 / 2:00.00")).toBeTruthy();
	});

	test("slider is disabled when no audio loaded", () => {
		const { container } = render(
			<PlayheadSlider value={0} audioDuration={null} onChange={noop} />,
		);
		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-disabled")).toBe("true");
	});

	test("slider is disabled when disabled prop is true", () => {
		const { container } = render(
			<PlayheadSlider value={0} audioDuration={10} disabled onChange={noop} />,
		);
		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-disabled")).toBe("true");
	});

	test("slider is enabled when audio is loaded and not disabled", () => {
		const { container } = render(
			<PlayheadSlider value={0} audioDuration={10} onChange={noop} />,
		);
		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-disabled")).toBeNull();
	});

	test("calls onChange with floored sample position", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<PlayheadSlider value={0} audioDuration={10} onChange={onChange} />,
		);
		const slider = container.querySelector("[role='slider']") as HTMLElement;
		// Simulate keyboard interaction — arrow right
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalled();
		// The value should be an integer (floored sample position)
		const calledWith = (onChange.mock.calls[0] as unknown as [number])[0];
		expect(calledWith).toBe(Math.floor(calledWith));
	});

	test("slider max corresponds to audioDuration in samples", () => {
		const duration = 5; // 5 seconds
		const { container } = render(
			<PlayheadSlider value={0} audioDuration={duration} onChange={noop} />,
		);
		const slider = container.querySelector("[role='slider']") as HTMLElement;
		expect(slider.getAttribute("aria-valuemax")).toBe(
			String(duration * SAMPLE_RATE),
		);
	});

	test("shows 0:00.00 when audioDuration is null", () => {
		render(<PlayheadSlider value={0} audioDuration={null} onChange={noop} />);
		expect(screen.getByText("0:00.00 / 0:00.00")).toBeTruthy();
	});

	test("renders buffered and pending overlays for streaming progress", () => {
		render(
			<PlayheadSlider
				value={0}
				audioDuration={10}
				seekableSamples={2 * SAMPLE_RATE}
				onChange={noop}
			/>,
		);

		const fill = screen.getByTestId("playhead-buffer-fill") as HTMLElement;
		const pending = screen.getByTestId(
			"playhead-buffer-pending",
		) as HTMLElement;

		expect(fill.style.width).toBe("20%");
		expect(pending).toBeTruthy();
	});

	test("clamps buffered overlay when seekable exceeds total duration", () => {
		render(
			<PlayheadSlider
				value={0}
				audioDuration={3}
				seekableSamples={999_999}
				onChange={noop}
			/>,
		);

		const fill = screen.getByTestId("playhead-buffer-fill") as HTMLElement;
		expect(fill.style.width).toBe("100%");
	});

	test("handles null seekable samples without crashing", () => {
		render(
			<PlayheadSlider
				value={0}
				audioDuration={8}
				seekableSamples={null}
				onChange={noop}
			/>,
		);

		const fill = screen.getByTestId("playhead-buffer-fill") as HTMLElement;
		expect(fill.style.width).toBe("0%");
		expect(screen.getByText("0:00.00 / 0:08.00")).toBeTruthy();
	});

	test("uses stream progress fallback when duration is unknown", () => {
		render(
			<PlayheadSlider
				value={0}
				audioDuration={null}
				seekableSamples={12_000}
				streamProgress={0.4}
				onChange={noop}
			/>,
		);

		const fill = screen.getByTestId("playhead-buffer-fill") as HTMLElement;
		expect(fill.style.width).toBe("40%");
	});
});
