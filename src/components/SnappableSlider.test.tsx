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

	test("skew !== 1: fill width uses skewed ratio", () => {
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} skew={0.5} />,
		);
		const fill = q(container, ".slider-fill") as HTMLElement;
		// With skew=0.5, ratio = (0.5)^0.5 = ~0.707
		expect(fill.style.width).not.toBe("50%");
	});

	test("range === 0: fill width is 0%", () => {
		const { container } = render(
			<SnappableSlider min={50} max={50} value={50} />,
		);
		const fill = q(container, ".slider-fill") as HTMLElement;
		expect(fill.style.width).toBe("0%");
	});

	test("enableSnap with snaps: value snaps to closest snap point", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={48}
				step={1}
				enableSnap={true}
				snaps={[0, 25, 50, 75, 100]}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		// 48 + 1 = 49, closest snap is 50
		expect(onChange).toHaveBeenCalledWith(50);
	});

	test("mouseDown starts drag and updates value", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		// Mock getBoundingClientRect
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.mouseDown(slider, { clientX: 100 });
		expect(onChange).toHaveBeenCalled();
		// Clean up: trigger mouseup
		fireEvent.mouseUp(document);
	});

	test("touchStart starts drag and updates value", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.touchStart(slider, { touches: [{ clientX: 150 }] });
		expect(onChange).toHaveBeenCalled();
		fireEvent.touchEnd(document);
	});

	test("Alt key sets isOptionKeyHeld and prevents snapping", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={48}
				step={1}
				enableSnap={true}
				snaps={[0, 25, 50, 75, 100]}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		// Press Alt key
		fireEvent.keyDown(slider, { key: "Alt" });
		// Now arrow key should NOT snap
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		// Without snap, 48 + 1 = 49 (not snapped to 50)
		expect(onChange).toHaveBeenCalledWith(49);
		// Release Alt
		fireEvent.keyUp(slider, { key: "Alt" });
	});

	test("Alt+mouseDown bypasses snap during drag", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				enableSnap={true}
				snaps={[0, 25, 50, 75, 100]}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		// Click at 60% (value=60) with Alt held — should NOT snap to 50 or 75
		fireEvent.mouseDown(slider, { clientX: 120, altKey: true });
		expect(onChange).toHaveBeenCalledWith(60);
		fireEvent.mouseUp(document);
	});

	test("mouseDown without Alt snaps during drag", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={0}
				max={100}
				value={50}
				enableSnap={true}
				snaps={[0, 25, 50, 75, 100]}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		// Click at 60% (value=60) without Alt — should snap to nearest (50 or 75)
		fireEvent.mouseDown(slider, { clientX: 120 });
		// 60 is closer to 50 than 75, so snaps to 50... wait 60-50=10, 75-60=15, so 50
		// Actually let's pick a value closer to 75: clientX=140 => 70%
		onChange.mockClear();
		fireEvent.mouseUp(document);
		fireEvent.mouseDown(slider, { clientX: 140 });
		// value=70, closest snap: 75 (distance 5) vs 50 (distance 20)
		expect(onChange).toHaveBeenCalledWith(75);
		fireEvent.mouseUp(document);
	});

	test("wheel up increases value", () => {
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
		fireEvent.wheel(slider, { deltaY: -1 });
		expect(onChange).toHaveBeenCalledWith(51);
	});

	test("wheel down decreases value", () => {
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
		fireEvent.wheel(slider, { deltaY: 1 });
		expect(onChange).toHaveBeenCalledWith(49);
	});

	test("wheel with shift uses finer step", () => {
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
		// fireEvent.wheel doesn't pass shiftKey through in happy-dom,
		// so we create and dispatch a proper WheelEvent
		const wheelEvent = document.createEvent("Event");
		wheelEvent.initEvent("wheel", true, true);
		Object.defineProperty(wheelEvent, "deltaY", { value: -1 });
		Object.defineProperty(wheelEvent, "shiftKey", { value: true });
		Object.defineProperty(wheelEvent, "preventDefault", { value: () => {} });
		slider.dispatchEvent(wheelEvent);
		// With shift, step = 10/10 = 1
		expect(onChange).toHaveBeenCalledWith(51);
	});

	test("drag with mousemove and mouseup cleans up", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.mouseDown(slider, { clientX: 100 });
		onChange.mockClear();
		// Simulate mousemove on document
		fireEvent.mouseMove(document, { clientX: 150 });
		// Trigger mouseup on document to stop drag
		fireEvent.mouseUp(document);
	});

	test("drag with touchmove and touchend cleans up", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.touchStart(slider, { touches: [{ clientX: 100 }] });
		onChange.mockClear();
		// Simulate touchmove on document
		fireEvent.touchMove(document, { touches: [{ clientX: 150 }] });
		// Trigger touchend on document to stop drag
		fireEvent.touchEnd(document);
	});

	test("formatTick formats snap and tick labels", () => {
		const fmt = (v: number) => `${v.toFixed(1)} s`;
		const { container } = render(
			<SnappableSlider
				min={0}
				max={10}
				value={5}
				snaps={[0, 5, 10]}
				formatTick={fmt}
			/>,
		);
		const labels = container.querySelectorAll(".slider-xval");
		const texts = Array.from(labels).map((el) => el.textContent);
		expect(texts).toContain("0.0 s");
		expect(texts).toContain("5.0 s");
		expect(texts).toContain("10.0 s");
	});

	test("without formatTick, raw values are shown", () => {
		const { container } = render(
			<SnappableSlider min={0} max={10} value={5} snaps={[0, 5, 10]} />,
		);
		const labels = container.querySelectorAll(".slider-xval");
		const texts = Array.from(labels).map((el) => el.textContent);
		expect(texts).toContain("0");
		expect(texts).toContain("5");
		expect(texts).toContain("10");
	});
});

describe("logarithmic mode", () => {
	test("fill at min is 0%", () => {
		const { container } = render(
			<SnappableSlider min={32} max={16384} value={32} logarithmic />,
		);
		const fill = q(container, ".slider-fill") as HTMLElement;
		expect(fill.style.width).toBe("0%");
	});

	test("fill at max is 100%", () => {
		const { container } = render(
			<SnappableSlider min={32} max={16384} value={16384} logarithmic />,
		);
		const fill = q(container, ".slider-fill") as HTMLElement;
		expect(fill.style.width).toBe("100%");
	});

	test("each octave occupies equal slider space", () => {
		// min=32, max=16384 → 9 octaves (32→64→128→...→16384)
		const octaves = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
		const ratios: number[] = [];
		for (const v of octaves) {
			const { container } = render(
				<SnappableSlider min={32} max={16384} value={v} logarithmic />,
			);
			const fill = q(container, ".slider-fill") as HTMLElement;
			ratios.push(Number.parseFloat(fill.style.width));
			cleanup();
		}
		// Each octave step should be ~11.11% (100/9)
		const expectedStep = 100 / 9;
		for (let i = 1; i < ratios.length; i++) {
			const step = ratios[i] - ratios[i - 1];
			expect(step).toBeCloseTo(expectedStep, 0);
		}
	});

	test("ArrowRight increases in log space", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider
				min={32}
				max={16384}
				value={1024}
				logarithmic
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalled();
		const newValue = (onChange.mock.calls[0] as unknown as [number])[0];
		expect(newValue).toBeGreaterThan(1024);
		expect(newValue).toBeLessThan(16384);
	});
});

describe("right-click behaviour", () => {
	test("right-click (button=2) does not move slider", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.mouseDown(slider, { clientX: 40, button: 2 });
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.mouseUp(document);
	});

	test("left-click (button=0) does move slider", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<SnappableSlider min={0} max={100} value={50} onChange={onChange} />,
		);
		const slider = q(container, '[role="slider"]') as HTMLElement;
		slider.getBoundingClientRect = () =>
			({
				left: 0,
				width: 200,
				top: 0,
				right: 200,
				bottom: 20,
				height: 20,
				x: 0,
				y: 0,
				toJSON: () => {},
			}) as DOMRect;
		fireEvent.mouseDown(slider, { clientX: 40, button: 0 });
		expect(onChange).toHaveBeenCalled();
		fireEvent.mouseUp(document);
	});
});
