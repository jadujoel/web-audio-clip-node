import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Playground example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "playground");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/playground/i);
		expect(errors).toEqual([]);
	});

	test("display panel renders with initial state", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		const stateOutput = display.locator("code:has-text('State:') + output");
		await expect(stateOutput).toBeVisible();
		await expect(stateOutput).toHaveText("initial");
	});

	test("transport buttons section renders", async ({ page }) => {
		const buttons = page.locator("section#buttons");
		await expect(buttons).toBeVisible();

		await expect(
			buttons.locator("button:has-text('Load Sound')"),
		).toBeVisible();
		await expect(buttons.locator("button:has-text('Start')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Stop')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Pause')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Resume')")).toBeVisible();
	});

	test("transport buttons have correct disabled states initially", async ({
		page,
	}) => {
		const buttons = page.locator("section#buttons");

		await expect(
			buttons.locator("button:has-text('Load Sound')"),
		).toBeEnabled();
		await expect(buttons.locator("button:has-text('Start')")).toBeEnabled();
		await expect(buttons.locator("button:has-text('Stop')")).toBeDisabled();
		await expect(buttons.locator("button:has-text('Pause')")).toBeDisabled();
		await expect(buttons.locator("button:has-text('Resume')")).toBeDisabled();
	});

	test("controls section renders with parameter controls", async ({ page }) => {
		const controls = page.locator("section#controls");
		await expect(controls).toBeVisible();

		for (const label of ["Rate", "Detune", "Gain", "Pan"]) {
			await expect(
				controls.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});

	test("parameter sliders are interactive", async ({ page }) => {
		const rateControl = page.locator(
			".audio-control:has(.control-label:has-text('Rate'))",
		);
		const slider = rateControl.locator("[role='slider']");
		await expect(slider).toBeVisible();
		await expect(slider).toHaveAttribute("aria-valuenow");

		const output = rateControl.locator(".control-output");
		await expect(output).toBeVisible();
		await expect(output).toHaveText(/x$/);
	});

	test("gain control shows dB value", async ({ page }) => {
		const gainControl = page.locator(
			".audio-control:has(.control-label:has-text('Gain'))",
		);
		const output = gainControl.locator(".control-output");
		await expect(output).toBeVisible();
		await expect(output).toHaveText(/dB$/);
	});

	test("playhead slider renders", async ({ page }) => {
		const playhead = page.locator(".playhead-slider");
		await expect(playhead).toBeVisible();

		const slider = playhead.locator("[role='slider']");
		await expect(slider).toBeVisible();

		const time = playhead.locator(".playhead-time");
		await expect(time).toBeVisible();
	});

	test("tempo input renders with default value", async ({ page }) => {
		const tempo = page.locator("input#tempo");
		await expect(tempo).toBeVisible();
		await expect(tempo).toHaveAttribute("type", "number");
	});

	test("loop checkbox renders", async ({ page }) => {
		const loop = page.locator("input#loop");
		await expect(loop).toBeVisible();
		await expect(loop).toHaveAttribute("type", "checkbox");
	});

	test("filter controls render", async ({ page }) => {
		for (const label of ["Lowpass", "Highpass"]) {
			await expect(
				page.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});
});
