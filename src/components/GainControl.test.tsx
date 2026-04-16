import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GainControl } from "./GainControl";

afterEach(cleanup);

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("GainControl", () => {
	test("renders label, toggle, slider, and dB output", () => {
		const { container } = render(
			<GainControl
				value={-6}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		expect(container.querySelector(".control-label")?.textContent).toBe("Gain");
		expect(container.querySelector(".control-toggle")).toBeTruthy();
		expect(container.querySelector('[role="slider"]')).toBeTruthy();
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("-6.0 dB");
	});

	test("disabled state when enabled=false", () => {
		const { container } = render(
			<GainControl
				value={-6}
				defaultValue={0}
				enabled={false}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		expect(container.querySelector(".audio-control--disabled")).toBeTruthy();
	});

	test("toggle fires onToggle", () => {
		const onToggle = vi.fn(() => {});
		const { container } = render(
			<GainControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={onToggle}
			/>,
		);
		fireEvent.click(q(container, ".control-toggle"));
		expect(onToggle).toHaveBeenCalledWith(false);
	});

	test("double-click resets to default", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<GainControl
				value={-24}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.doubleClick(q(container, '[role="slider"]'));
		expect(onChange).toHaveBeenCalledWith(0);
	});

	test("click-to-edit commits value", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<GainControl
				value={-24}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "-12" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(-12);
	});

	test("click-to-edit: Escape cancels", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<GainControl
				value={-24}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "999" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).not.toHaveBeenCalled();
	});

	test("click-to-edit: clamps value", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<GainControl
				value={-24}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "999" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(0);
	});
});
