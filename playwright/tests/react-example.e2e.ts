import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("React example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "react");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/react/i);
		expect(errors).toEqual([]);
	});

	test("transport buttons render", async ({ page }) => {
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

	test("transport buttons have correct initial disabled states", async ({
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

	test("rate control renders with slider and value", async ({ page }) => {
		const rateControl = page.locator(
			".audio-control:has(.control-label:has-text('Rate'))",
		);
		await expect(rateControl).toBeVisible();

		const slider = rateControl.locator("[role='slider']");
		await expect(slider).toBeVisible();

		const output = rateControl.locator(".control-output");
		await expect(output).toHaveText(/x$/);
	});

	test("gain control renders with slider and dB value", async ({ page }) => {
		const gainControl = page.locator(
			".audio-control:has(.control-label:has-text('Gain'))",
		);
		await expect(gainControl).toBeVisible();

		const slider = gainControl.locator("[role='slider']");
		await expect(slider).toBeVisible();

		const output = gainControl.locator(".control-output");
		await expect(output).toHaveText(/dB$/);
	});

	test("control toggles are present", async ({ page }) => {
		const toggles = page.locator(".control-toggle");
		const count = await toggles.count();
		expect(count).toBeGreaterThanOrEqual(2);
	});
});
