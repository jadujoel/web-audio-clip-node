import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FilterControl } from "./FilterControl";

afterEach(cleanup);

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("FilterControl", () => {
	test("renders label and toggle", () => {
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={16384}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		expect(container.querySelector(".control-label")?.textContent).toBe(
			"Lowpass",
		);
		expect(container.querySelector(".control-toggle")).toBeTruthy();
		expect(container.querySelector('[role="slider"]')).toBeTruthy();
	});

	test("displays Hz for low values", () => {
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={440}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("440 Hz");
	});

	test("displays kHz for high values", () => {
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={2000}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("2.0 kHz");
	});

	test("disabled state when enabled=false", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1000}
				defaultValue={16384}
				enabled={false}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		expect(container.querySelector(".audio-control--disabled")).toBeTruthy();
		const slider = q(container, '[role="slider"]');
		expect(slider.getAttribute("aria-disabled")).toBe("true");
	});

	test("toggle fires onToggle", () => {
		const onToggle = vi.fn(() => {});
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1000}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={onToggle}
			/>,
		);
		const toggle = q(container, ".control-toggle");
		fireEvent.click(toggle);
		expect(onToggle).toHaveBeenCalledWith(false);
	});

	test("double-click resets to default", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1000}
				defaultValue={16384}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.doubleClick(slider);
		expect(onChange).toHaveBeenCalledWith(16384);
	});

	test("click-to-edit value display", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1000}
				defaultValue={16384}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		expect(input).toBeTruthy();
		fireEvent.change(input, { target: { value: "5000" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(5000);
	});

	test("click-to-edit: Escape cancels", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1000}
				defaultValue={16384}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).not.toHaveBeenCalled();
	});

	test("slider uses logarithmic mode", () => {
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={32}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		// At min value (32), fill should be 0%
		const fill = container.querySelector(".slider-fill") as HTMLElement;
		expect(fill.style.width).toBe("0%");
	});

	test("slider has snap lines at octave boundaries", () => {
		const { container } = render(
			<FilterControl
				label="Lowpass"
				controlKey="lowpass"
				value={1024}
				defaultValue={16384}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const snaps = container.querySelectorAll(".slider-snap");
		// Hertz preset has 10 snap points: 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384
		expect(snaps.length).toBe(10);
	});
});
