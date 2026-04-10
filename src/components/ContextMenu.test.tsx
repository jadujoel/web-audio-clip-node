import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

function renderMenu(overrides = {}) {
	const defaults = {
		x: 100,
		y: 100,
		snap: "none",
		min: 0,
		max: 4,
		maxLocked: false,
		audioDuration: 10,
		onSnapChange: mock(() => {}),
		onMinChange: mock(() => {}),
		onMaxChange: mock(() => {}),
		onMaxLockedChange: mock(() => {}),
		onClose: mock(() => {}),
	};
	const props = { ...defaults, ...overrides };
	return { ...render(<ContextMenu {...props} />), props };
}

describe("ContextMenu", () => {
	test("renders with snap options", () => {
		const { props } = renderMenu();
		const menu = document.querySelector('[role="menu"]');
		expect(menu).toBeTruthy();
		const items = document.querySelectorAll('[role="menuitemradio"]');
		expect(items.length).toBe(6); // none, beat, bar, 8th, 16th, integer
		// Current snap should be checked
		const noneItem = items[0];
		expect(noneItem.getAttribute("aria-checked")).toBe("true");
		void props;
	});

	test("clicking snap option calls onSnapChange", () => {
		const { props } = renderMenu();
		const items = document.querySelectorAll('[role="menuitemradio"]');
		fireEvent.click(items[1]); // Beat
		expect(props.onSnapChange).toHaveBeenCalledWith("beat");
	});

	test("active snap is highlighted", () => {
		renderMenu({ snap: "bar" });
		const items = document.querySelectorAll('[role="menuitemradio"]');
		const barItem = items[2];
		expect(barItem.getAttribute("aria-checked")).toBe("true");
		expect(barItem.className).toContain("active");
	});

	test("renders min/max inputs", () => {
		renderMenu({ min: 0, max: 10 });
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		expect(inputs.length).toBe(2);
		expect(inputs[0].defaultValue).toBe("0");
		expect(inputs[1].defaultValue).toBe("10");
	});

	test("min input blur calls onMinChange", () => {
		const { props } = renderMenu();
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		fireEvent.change(inputs[0], { target: { value: "1.5" } });
		fireEvent.blur(inputs[0]);
		expect(props.onMinChange).toHaveBeenCalledWith(1.5);
	});

	test("max input blur calls onMaxChange", () => {
		const { props } = renderMenu();
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		fireEvent.change(inputs[1], { target: { value: "8" } });
		fireEvent.blur(inputs[1]);
		expect(props.onMaxChange).toHaveBeenCalledWith(8);
	});

	test("max input is disabled when maxLocked", () => {
		renderMenu({ maxLocked: true });
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		expect(inputs[1].disabled).toBe(true);
	});

	test("maxLocked checkbox calls onMaxLockedChange", () => {
		const { props } = renderMenu({ audioDuration: 10 });
		const checkbox = document.querySelector<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		expect(checkbox).toBeTruthy();
		if (!checkbox) throw new Error("checkbox not found");
		fireEvent.click(checkbox);
		expect(props.onMaxLockedChange).toHaveBeenCalledWith(true);
	});

	test("maxLocked checkbox hidden when no audioDuration", () => {
		renderMenu({ audioDuration: null });
		const checkbox = document.querySelector(
			'.context-menu__field input[type="checkbox"]',
		);
		expect(checkbox).toBeNull();
	});

	test("Escape closes menu", () => {
		const { props } = renderMenu();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(props.onClose).toHaveBeenCalled();
	});

	test("click outside closes menu", () => {
		const { props } = renderMenu();
		fireEvent.mouseDown(document.body);
		expect(props.onClose).toHaveBeenCalled();
	});
});
