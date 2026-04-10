import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AudioControl } from "./AudioControl";

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

afterEach(cleanup);

describe("AudioControl", () => {
	test("renders label, slider, output", () => {
		const { container } = render(
			<AudioControl label="Gain" min={0} max={100} value={50} />,
		);
		expect(container.querySelector(".control-label")?.textContent).toBe("Gain");
		expect(container.querySelector('[role="slider"]')).toBeTruthy();
		expect(container.querySelector(".control-output")).toBeTruthy();
	});

	test("context menu opens on right-click when hasSnap is true", () => {
		const { container } = render(
			<AudioControl label="Offset" min={0} max={4} value={0} hasSnap={true} />,
		);
		const control = q(container, ".audio-control");
		fireEvent.contextMenu(control, { clientX: 200, clientY: 200 });
		const menu = document.querySelector('[role="menu"]');
		expect(menu).toBeTruthy();
	});

	test("no context menu on right-click when hasSnap is false", () => {
		const { container } = render(
			<AudioControl label="Gain" min={0} max={100} value={50} />,
		);
		const control = q(container, ".audio-control");
		fireEvent.contextMenu(control, { clientX: 200, clientY: 200 });
		const menu = document.querySelector('[role="menu"]');
		expect(menu).toBeNull();
	});

	test("no snap dropdown is rendered (snap is in context menu now)", () => {
		const { container } = render(
			<AudioControl label="Offset" min={0} max={4} value={0} hasSnap={true} />,
		);
		expect(container.querySelector(".control-snap")).toBeNull();
		expect(container.querySelector(".control-snap-placeholder")).toBeNull();
	});

	test("slider is labelled by the label element", () => {
		const { container } = render(
			<AudioControl label="Pan" min={-1} max={1} value={0} />,
		);
		const label = q(container, ".control-label");
		const slider = q(container, '[role="slider"]');
		const labelId = label.getAttribute("id");
		expect(labelId).toBeTruthy();
		expect(slider.getAttribute("aria-labelledby")).toBe(labelId);
	});

	test("renders toggle checkbox when hasToggle is true", () => {
		const { container } = render(
			<AudioControl
				label="FadeIn"
				min={0}
				max={4}
				value={0}
				hasToggle={true}
				enabled={true}
			/>,
		);
		const toggle = q(container, ".control-toggle") as HTMLInputElement;
		expect(toggle).toBeTruthy();
		expect(toggle.checked).toBe(true);
	});

	test("renders toggle placeholder when hasToggle is false", () => {
		const { container } = render(
			<AudioControl label="Offset" min={0} max={4} value={0} />,
		);
		expect(container.querySelector(".control-toggle")).toBeNull();
		expect(container.querySelector(".control-toggle-placeholder")).toBeTruthy();
	});

	test("onToggle fires when toggle is changed", () => {
		const onToggle = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				hasToggle={true}
				enabled={true}
				onToggle={onToggle}
			/>,
		);
		const toggle = q(container, ".control-toggle") as HTMLInputElement;
		fireEvent.click(toggle);
		expect(onToggle).toHaveBeenCalledWith(false);
	});

	test("onSnapChange fires when snap is selected in context menu", () => {
		const onSnapChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Offset"
				min={0}
				max={4}
				value={0}
				hasSnap={true}
				onSnapChange={onSnapChange}
			/>,
		);
		const control = q(container, ".audio-control");
		fireEvent.contextMenu(control, { clientX: 200, clientY: 200 });
		const items = document.querySelectorAll('[role="menuitemradio"]');
		fireEvent.click(items[1]); // Beat
		expect(onSnapChange).toHaveBeenCalledWith("beat");
	});

	test("displays formatted output value", () => {
		const { container } = render(
			<AudioControl
				label="Gain"
				controlKey="gain"
				min={-100}
				max={0}
				value={-6}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("-6.0 dB");
	});

	test("passes controlKey for aria-valuetext", () => {
		const { container } = render(
			<AudioControl
				label="Gain"
				controlKey="gain"
				min={-100}
				max={0}
				value={-6}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		const valueText = slider.getAttribute("aria-valuetext");
		expect(valueText).toContain("dB");
	});

	test("passes defaultValue through to slider for double-click reset", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Pan"
				min={-1}
				max={1}
				value={0.5}
				defaultValue={0}
				onChange={onChange}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.doubleClick(slider);
		expect(onChange).toHaveBeenCalledWith(0);
	});

	test("clicking output starts editing", () => {
		const { container } = render(
			<AudioControl label="Gain" min={0} max={100} value={50} />,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.type).toBe("text");
	});

	test("editing: Enter commits value", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				onChange={onChange}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "75" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(75);
	});

	test("editing: Escape cancels without changing value", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				onChange={onChange}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "999" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).not.toHaveBeenCalled();
		// Should revert to button display
		expect(container.querySelector("button.control-output")).toBeTruthy();
	});

	test("editing: value is clamped to [min, max]", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				onChange={onChange}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "999" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(100);
	});

	test("editing: blur commits value", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				onChange={onChange}
			/>,
		);
		const output = q(container, ".control-output");
		fireEvent.click(output);
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "75" } });
		fireEvent.blur(input);
		expect(onChange).toHaveBeenCalledWith(75);
	});

	test("disabled state: slider and controls dimmed when toggle off", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<AudioControl
				label="Gain"
				min={0}
				max={100}
				value={50}
				hasToggle={true}
				enabled={false}
				onChange={onChange}
			/>,
		);
		expect(container.querySelector(".audio-control--disabled")).toBeTruthy();
		const slider = q(container, '[role="slider"]');
		expect(slider.getAttribute("aria-disabled")).toBe("true");
	});
});
