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
		await expect(page.locator("#stop")).toBeVisible();
		await expect(page.locator("#status")).toHaveText("Idle");
		expect(errors).toEqual([]);
	});

	test("stop button is disabled before streaming starts", async ({ page }) => {
		await expect(page.locator("#stop")).toBeDisabled();
	});
});
