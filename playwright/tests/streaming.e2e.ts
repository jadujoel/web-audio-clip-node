import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Streaming example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "streaming");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/stream/i);
		expect(errors).toEqual([]);
	});

	test("heading renders", async ({ page }) => {
		await expect(page.locator("h1")).toContainText("Streaming");
	});

	test("format selector renders with options", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const options = select.locator("option");
		const count = await options.count();
		expect(count).toBeGreaterThanOrEqual(3);
	});

	test("audio URL input renders", async ({ page }) => {
		const input = page.locator("input#url");
		await expect(input).toBeVisible();
		await expect(input).toHaveAttribute("type", "text");
	});

	test("stream & play button renders", async ({ page }) => {
		await expect(
			page.locator("button:has-text('Stream & Play')"),
		).toBeVisible();
	});

	test("pause and stop buttons render", async ({ page }) => {
		await expect(page.locator("button:has-text('Pause')")).toBeVisible();
		await expect(page.locator("button:has-text('Stop')")).toBeVisible();
	});

	test("display panel renders with initial state", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		const stateOutput = display.locator("code:has-text('State:') + output");
		await expect(stateOutput).toBeVisible();
		await expect(stateOutput).toHaveText("initial");
	});

	test("parameter controls render", async ({ page }) => {
		for (const label of ["Rate", "Gain"]) {
			await expect(
				page.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});

	test("playhead slider renders", async ({ page }) => {
		const playhead = page.locator(".playhead-slider");
		await expect(playhead).toBeVisible();
	});

	test("tempo input renders", async ({ page }) => {
		const tempo = page.locator("input#tempo");
		await expect(tempo).toBeVisible();
	});

	test("network speed selector renders", async ({ page }) => {
		const throttle = page.locator("select#throttle-select");
		await expect(throttle).toBeVisible();
	});
});
