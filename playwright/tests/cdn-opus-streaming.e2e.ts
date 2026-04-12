import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("CDN Opus Streaming example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "cdn-opus-streaming");
	});

	test("page loads with title and streaming controls", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		await expect(page).toHaveTitle(/CDN Opus Streaming/i);
		await expect(page.locator("#start")).toBeVisible();
		await expect(page.locator("#status")).toHaveText("Idle");
		expect(errors).toEqual([]);
	});

	test("CDN module exports resolve without SyntaxError", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		// Wait for the module script to fully load
		await page.waitForLoadState("networkidle");

		const importErrors = errors.filter(
			(e) =>
				e.includes("does not provide an export") || e.includes("SyntaxError"),
		);
		expect(importErrors).toEqual([]);
	});

	test("play button toggles to stop after click", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming progress can be flaky in headless Firefox",
		);

		const btn = page.locator("#start");
		await expect(btn).toHaveText("Play");
		await btn.click();

		await expect(btn).toHaveText("Stop", { timeout: 15000 });
		await expect(page.locator("#status")).not.toContainText("Error:");
	});
});
