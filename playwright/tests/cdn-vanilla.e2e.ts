import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("CDN Vanilla example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "cdn-vanilla");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/CDN Vanilla/i);
		expect(errors).toEqual([]);
	});

	test("CDN module exports resolve without SyntaxError", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		await page.waitForLoadState("networkidle");

		const importErrors = errors.filter(
			(e) =>
				e.includes("does not provide an export") || e.includes("SyntaxError"),
		);
		expect(importErrors).toEqual([]);
	});

	test("Play, Pause, and Resume buttons render", async ({ page }) => {
		await expect(page.locator("#play")).toBeVisible();
		await expect(page.locator("#pause")).toBeVisible();
		await expect(page.locator("#resume")).toBeVisible();
	});

	test("Pause and Resume are initially disabled", async ({ page }) => {
		await expect(page.locator("#pause")).toBeDisabled();
		await expect(page.locator("#resume")).toBeDisabled();
	});

	test("status shows Ready initially", async ({ page }) => {
		await expect(page.locator("#status")).toHaveText("Ready");
	});

	test("clicking Play does not throw getChannelData error", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		await page.locator("#play").click();
		// Give time for any async errors to surface
		await page.waitForTimeout(500);

		const channelDataErrors = errors.filter((e) =>
			e.includes("getChannelData"),
		);
		expect(channelDataErrors).toEqual([]);
	});
});
