import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DetuneControl } from "./DetuneControl";

afterEach(cleanup);

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("DetuneControl", () => {
	test("displays cents format", () => {
		const { container } = render(
			<DetuneControl
				value={100}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("100 cents");
	});

	test("displays 0 cents at zero", () => {
		const { container } = render(
			<DetuneControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("0 cents");
	});

	test("displays negative cents", () => {
		const { container } = render(
			<DetuneControl
				value={-1200}
				defaultValue={0}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("-1200 cents");
	});

	test("disabled state when enabled=false", () => {
		const { container } = render(
			<DetuneControl
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
		const onToggle = vi.fn(() => {});
		const { container } = render(
			<DetuneControl
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
			<DetuneControl
				value={500}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.doubleClick(q(container, '[role="slider"]'));
		expect(onChange).toHaveBeenCalledWith(0);
	});

	test("does not fire onChange when disabled", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<DetuneControl
				value={0}
				defaultValue={0}
				enabled={false}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		const slider = q(container, '[role="slider"]');
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).not.toHaveBeenCalled();
	});

	test("click-to-edit commits value", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<DetuneControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "500" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(500);
	});

	test("click-to-edit: Escape cancels", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<DetuneControl
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

	test("click-to-edit: clamps value", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<DetuneControl
				value={0}
				defaultValue={0}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "9999" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(2400);
	});
});
