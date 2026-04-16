import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PlaybackRateControl } from "./PlaybackRateControl";

afterEach(cleanup);

function q(
	container: { querySelector: (s: string) => Element | null },
	selector: string,
): Element {
	const el = container.querySelector(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("PlaybackRateControl", () => {
	test("displays rate format", () => {
		const { container } = render(
			<PlaybackRateControl
				value={1}
				defaultValue={1}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("1.00x");
	});

	test("displays negative rate", () => {
		const { container } = render(
			<PlaybackRateControl
				value={-1}
				defaultValue={1}
				enabled={true}
				onChange={() => {}}
				onToggle={() => {}}
			/>,
		);
		const output = q(container, ".control-output");
		expect(output.textContent).toBe("-1.00x");
	});

	test("disabled state when enabled=false", () => {
		const { container } = render(
			<PlaybackRateControl
				value={1}
				defaultValue={1}
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
			<PlaybackRateControl
				value={1}
				defaultValue={1}
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
			<PlaybackRateControl
				value={2}
				defaultValue={1}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.doubleClick(q(container, '[role="slider"]'));
		expect(onChange).toHaveBeenCalledWith(1);
	});

	test("click-to-edit commits value", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<PlaybackRateControl
				value={1}
				defaultValue={1}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "2" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(2);
	});

	test("click-to-edit: Escape cancels", () => {
		const onChange = vi.fn(() => {});
		const { container } = render(
			<PlaybackRateControl
				value={1}
				defaultValue={1}
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
			<PlaybackRateControl
				value={1}
				defaultValue={1}
				enabled={true}
				onChange={onChange}
				onToggle={() => {}}
			/>,
		);
		fireEvent.click(q(container, ".control-output"));
		const input = q(container, "input.control-output") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "99" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(2);
	});
});
