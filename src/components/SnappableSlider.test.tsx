import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SnappableSlider } from "./SnappableSlider";

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

afterEach(cleanup);

describe("SnappableSlider", () => {
	test("renders with role=slider and ARIA attributes", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} />,
		);
		const slider = q(container, '[role="slider"]');
		expect(slider).toBeTruthy();
		expect(slider.getAttribute("aria-valuemin")).toBe("0");
		expect(slider.getAttribute("aria-valuemax")).toBe("100");
		expect(slider.getAttribute("aria-valuenow")).toBe("50");
		expect(slider.getAttribute("tabindex")).toBe("0");
	});

	test("renders aria-valuetext when provided", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} valueText="50 percent" />,
		);
		const slider = q(container, '[role="slider"]');
		expect(slider.getAttribute("aria-valuetext")).toBe("50 percent");
	});

	test("renders aria-labelledby when provided", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} labelId="my-label" />,
		);
		const slider = q(container, '[role="slider"]');
		expect(slider.getAttribute("aria-labelledby")).toBe("my-label");
	});

	test("ArrowRight increases value by step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				step={5}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(55);
	});

	test("ArrowLeft decreases value by step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				step={5}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowLeft" });
		expect(onChange).toHaveBeenCalledWith(45);
	});

	test("ArrowUp increases value by step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				step={10}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowUp" });
		expect(onChange).toHaveBeenCalledWith(60);
	});

	test("ArrowDown decreases value by step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				step={10}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowDown" });
		expect(onChange).toHaveBeenCalledWith(40);
	});

	test("Home sets to min", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={10} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "Home" });
		expect(onChange).toHaveBeenCalledWith(10);
	});

	test("End sets to max", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={200} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "End" });
		expect(onChange).toHaveBeenCalledWith(200);
	});

	test("PageUp increases by 10x step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={20}
				step={1}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "PageUp" });
		expect(onChange).toHaveBeenCalledWith(30);
	});

	test("PageDown decreases by 10x step", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				step={1}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "PageDown" });
		expect(onChange).toHaveBeenCalledWith(40);
	});

	test("clamps at max", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={99}
				step={5}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(100);
	});

	test("clamps at min", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={2}
				step={5}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowLeft" });
		expect(onChange).toHaveBeenCalledWith(0);
	});

	test("double-click resets to defaultValue", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={75}
				defaultValue={50}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.doubleClick(slider);
		expect(onChange).toHaveBeenCalledWith(50);
	});

	test("double-click without defaultValue does nothing", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={75} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.doubleClick(slider);
		expect(onChange).not.toHaveBeenCalled();
	});

	test("default step is (max - min) / 100", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(51);
	});

	test("renders snap elements for snaps array", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} snaps={[25, 50, 75]} />,
		);
		const snapMarkers = container.querySelectorAll(".slider-snap");
		expect(snapMarkers.length).toBe(3);
	});

	test("slider has fill width based on value ratio", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={25} />,
		);
		const fill = q(container, ".slider-fill") as HTMLElement;
		expect(fill.style.width).toBe("25%");
	});
});
