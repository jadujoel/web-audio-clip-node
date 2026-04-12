import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("CDN Vanilla example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "cdn-vanilla");
	});

	test("page loads with correct title", async ({ page }) => {
		await expect(page).toHaveTitle(/CDN Vanilla/i);
	});

	test("transport buttons render with correct initial state", async ({
		page,
	}) => {
		const play = page.locator("#play");
		const pause = page.locator("#pause");
		const stop = page.locator("#stop");

		await expect(play).toBeVisible();
		await expect(play).toBeEnabled();
		await expect(pause).toBeDisabled();
		await expect(stop).toBeDisabled();
	});

	test("initial state displays 'initial'", async ({ page }) => {
		const stateValue = page.locator("#stateValue");
		await expect(stateValue).toHaveText("initial");
	});

	test("rate slider has correct default value", async ({ page }) => {
		const rate = page.locator("#rate");
		await expect(rate).toHaveValue("1");

		const rateOutput = page.locator("#rateValue");
		await expect(rateOutput).toHaveText("1.00x");
	});

	test("gain slider has correct default value", async ({ page }) => {
		const gain = page.locator("#gain");
		await expect(gain).toHaveValue("0.95");

		const gainOutput = page.locator("#gainValue");
		await expect(gainOutput).toHaveText("0.95");
	});

	test("changing rate slider updates output display", async ({ page }) => {
		await page.locator("#rate").evaluate((el: HTMLInputElement) => {
			el.value = "1.50";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const rateOutput = page.locator("#rateValue");
		await expect(rateOutput).toHaveText("1.50x");
	});

	test("changing gain slider updates output display", async ({ page }) => {
		await page.locator("#gain").evaluate((el: HTMLInputElement) => {
			el.value = "0.50";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const gainOutput = page.locator("#gainValue");
		await expect(gainOutput).toHaveText("0.50");
	});

	test("changing detune slider updates output display", async ({ page }) => {
		await page.locator("#detune").evaluate((el: HTMLInputElement) => {
			el.value = "100";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const detuneOutput = page.locator("#detuneValue");
		await expect(detuneOutput).toHaveText("100 cents");
	});

	test("changing pan slider updates output display", async ({ page }) => {
		await page.locator("#pan").evaluate((el: HTMLInputElement) => {
			el.value = "-0.50";
			el.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const panOutput = page.locator("#panValue");
		await expect(panOutput).toHaveText("-0.50");
	});

	test("all control sliders are present", async ({ page }) => {
		for (const id of [
			"rate",
			"detune",
			"gain",
			"pan",
			"loopStart",
			"loopEnd",
			"loopCrossfade",
			"fadeIn",
			"fadeOut",
			"playhead",
		]) {
			await expect(page.locator(`#${id}`)).toBeVisible();
		}
	});

	test("all stat displays are present", async ({ page }) => {
		for (const id of [
			"stateValue",
			"playheadValue",
			"sampleValue",
			"durationValue",
			"loopCountValue",
			"startCountValue",
			"swapCountValue",
		]) {
			await expect(page.locator(`#${id}`)).toBeVisible();
		}
	});
});
