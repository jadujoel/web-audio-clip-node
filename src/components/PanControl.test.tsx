import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PanControl } from "./PanControl";

afterEach(cleanup);

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("PanControl", () => {
	test("displays C for center", () => {
		const { container } = render(
			<PanControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("C");
	});

	test("displays L for left pan", () => {
		const { container } = render(
			<PanControl
				value={-0.75}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("L75");
	});

	test("displays R for right pan", () => {
		const { container } = render(
			<PanControl
				value={0.5}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("R50");
	});

	test("disabled state when enabled=false", () => {
		const { container } = render(
			<PanControl
				value={0}
				defaultValue={0}
				enabled={false}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		expect(container.querySelector(".audio-control--disabled")).toBeTruthy();
	});

	test("toggle fires onToggle", () => {
		const onToggle = mock(() => {});
		const { container } = render(
			<PanControl
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
		const onChange = mock(() => {});
		const { container } = render(
			<PanControl
				value={0.5}
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
		const onChange = mock(() => {});
		const { container } = render(
			<PanControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "0.5" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(0.5);
	});

	test("click-to-edit: Escape cancels", () => {
		const onChange = mock(() => {});
		const { container } = render(
			<PanControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).not.toHaveBeenCalled();
	});
});
