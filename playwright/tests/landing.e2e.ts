import { expect, test } from "@playwright/test";
import { openLanding } from "../helpers/navigation";

test.describe("Landing page", () => {
	test("renders all example links", async ({ page }) => {
		await openLanding(page);
		await expect(page).toHaveTitle(/web-audio-clip-node/i);

		const links = page.locator("a[href]");
		const hrefs = await links.evaluateAll((els) =>
			els.map((el) => el.getAttribute("href")).filter(Boolean),
		);

		for (const name of [
			"playground",
			"cdn-vanilla",
			"esm-bundler",
			"react",
			"self-hosted",
			"streaming",
		]) {
			expect(hrefs).toContain(name);
		}
	});

	test("each card navigates to the correct example", async ({ page }) => {
		await openLanding(page);

		const card = page.locator('a[href="cdn-vanilla"]');
		await expect(card).toBeVisible();
		await card.click();
		await page.waitForLoadState("domcontentloaded");
		expect(page.url()).toContain("/cdn-vanilla");
	});
});
