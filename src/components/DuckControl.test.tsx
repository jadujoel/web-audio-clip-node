import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuckControl } from "./DuckControl";

afterEach(cleanup);

describe("DuckControl", () => {
	const defaultProps = {
		threshold: -40,
		attack: 0.01,
		release: 0.5,
		depth: 80,
		lookAhead: 0,
		reductionDb: 0,
		enabled: true,
		onThresholdChange: vi.fn(),
		onAttackChange: vi.fn(),
		onReleaseChange: vi.fn(),
		onDepthChange: vi.fn(),
		onLookAheadChange: vi.fn(),
		onToggle: vi.fn(),
	};

	it("renders all parameter labels", () => {
		render(<DuckControl {...defaultProps} />);
		expect(screen.getByText("Threshold")).toBeDefined();
		expect(screen.getByText("Attack")).toBeDefined();
		expect(screen.getByText("Release")).toBeDefined();
		expect(screen.getByText("Depth")).toBeDefined();
		expect(screen.getByText("Lookahead")).toBeDefined();
		expect(screen.getByText("Reduction")).toBeDefined();
	});

	it("renders the legend", () => {
		render(<DuckControl {...defaultProps} />);
		expect(screen.getByText("Sidechain Duck")).toBeDefined();
	});

	it("renders toggle checkbox", () => {
		render(<DuckControl {...defaultProps} />);
		const toggle = screen
			.getByText("Sidechain Duck")
			.closest("legend")
			?.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(toggle).toBeDefined();
		expect(toggle.checked).toBe(true);
	});

	it("disables controls when not enabled", () => {
		render(<DuckControl {...defaultProps} enabled={false} />);
		const controls = document.querySelectorAll(".audio-control--disabled");
		expect(controls.length).toBe(5);
	});

	it("each param row has toggle placeholder for 4-column grid alignment", () => {
		const { container } = render(<DuckControl {...defaultProps} />);
		const rows = container.querySelectorAll(".audio-control");
		// 5 param rows + 1 reduction meter row
		expect(rows.length).toBe(6);
		for (const row of rows) {
			expect(row.querySelector(".control-toggle-placeholder")).not.toBeNull();
		}
	});

	it("sliders are interactive when enabled", () => {
		const { container } = render(<DuckControl {...defaultProps} />);
		const sliders = container.querySelectorAll('[role="slider"]');
		expect(sliders.length).toBe(5);
		for (const slider of sliders) {
			expect(slider.getAttribute("aria-disabled")).toBeNull();
			expect(slider.getAttribute("tabindex")).toBe("0");
		}
	});
});
