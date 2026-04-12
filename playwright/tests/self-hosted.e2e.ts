import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Self-Hosted example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "self-hosted");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/self.hosted/i);
		expect(errors).toEqual([]);
	});

	test("heading renders", async ({ page }) => {
		await expect(page.locator("h1")).toContainText("Self-Hosted");
	});

	test("play and stop buttons render", async ({ page }) => {
		await expect(page.locator("#play")).toBeVisible();
		await expect(page.locator("#stop")).toBeVisible();
	});

	test("play button is enabled, stop is disabled initially", async ({
		page,
	}) => {
		await expect(page.locator("#play")).toBeEnabled();
		await expect(page.locator("#stop")).toBeDisabled();
	});

	test("status shows initial message", async ({ page }) => {
		const status = page.locator("#status");
		await expect(status).toBeVisible();
		await expect(status).toHaveText(/click play/i);
	});
});
