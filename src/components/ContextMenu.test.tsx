import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
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
		onSnapChange: vi.fn(() => {}),
		onMinChange: vi.fn(() => {}),
		onMaxChange: vi.fn(() => {}),
		onMaxLockedChange: vi.fn(() => {}),
		onClose: vi.fn(() => {}),
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

	test("max input is disabled when maxLocked and audioDuration set", () => {
		renderMenu({ maxLocked: true, audioDuration: 10 });
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		expect(inputs[1].disabled).toBe(true);
	});

	test("max input is editable when maxLocked but no audioDuration", () => {
		renderMenu({ maxLocked: true, audioDuration: null });
		const inputs = document.querySelectorAll<HTMLInputElement>(
			".context-menu__input",
		);
		expect(inputs[1].disabled).toBe(false);
	});

	test("maxLocked checkbox calls onMaxLockedChange", () => {
		const { props } = renderMenu({ audioDuration: 10 });
		const checkbox = document.querySelector<HTMLInputElement>(
			".context-menu__field .control-toggle",
		);
		expect(checkbox).toBeTruthy();
		if (!checkbox) throw new Error("checkbox not found");
		fireEvent.click(checkbox);
		expect(props.onMaxLockedChange).toHaveBeenCalledWith(true);
	});

	test("maxLocked checkbox visible even when no audioDuration", () => {
		renderMenu({ audioDuration: null });
		const checkbox = document.querySelector(
			".context-menu__field .control-toggle",
		);
		expect(checkbox).toBeTruthy();
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

	test("snapMode=preset shows Enable snap checkbox instead of radio buttons", () => {
		renderMenu({ snapMode: "preset", snap: "preset" });
		const radios = document.querySelectorAll('[role="menuitemradio"]');
		expect(radios.length).toBe(0);
		const checkbox = document.querySelector<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		expect(checkbox).toBeTruthy();
		expect(checkbox?.checked).toBe(true);
	});

	test("snapMode=preset with snap=none shows unchecked Enable snap", () => {
		renderMenu({ snapMode: "preset", snap: "none" });
		const checkbox = document.querySelector<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		expect(checkbox?.checked).toBe(false);
	});

	test("snapMode=preset enable snap checkbox calls onSnapChange with 'preset'", () => {
		const { props } = renderMenu({ snapMode: "preset", snap: "none" });
		const checkbox = document.querySelector<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		if (!checkbox) throw new Error("checkbox not found");
		fireEvent.click(checkbox);
		expect(props.onSnapChange).toHaveBeenCalledWith("preset");
	});

	test("snapMode=preset disable snap checkbox calls onSnapChange with 'none'", () => {
		const { props } = renderMenu({ snapMode: "preset", snap: "preset" });
		const checkbox = document.querySelector<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		if (!checkbox) throw new Error("checkbox not found");
		fireEvent.click(checkbox);
		expect(props.onSnapChange).toHaveBeenCalledWith("none");
	});

	test("showMaxLock=false hides the Max = file length row", () => {
		renderMenu({ showMaxLock: false });
		const checkboxes = document.querySelectorAll<HTMLInputElement>(
			'.context-menu__field input[type="checkbox"]',
		);
		// No maxLocked checkbox when showMaxLock is false
		const labels = document.querySelectorAll(".context-menu__field");
		const hasMaxLabel = Array.from(labels).some((el) =>
			el.textContent?.includes("Max = file length"),
		);
		expect(hasMaxLabel).toBe(false);
		expect(checkboxes.length).toBe(0);
	});

	test("showMaxLock=true (default) shows the Max = file length row", () => {
		renderMenu({ showMaxLock: true });
		const labels = document.querySelectorAll(".context-menu__field");
		const hasMaxLabel = Array.from(labels).some((el) =>
			el.textContent?.includes("Max = file length"),
		);
		expect(hasMaxLabel).toBe(true);
	});
});
