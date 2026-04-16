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
			"cdn-opus-streaming",
			"esm-bundler",
			"streaming",
		]) {
			expect(hrefs).toContain(name);
		}
	});

	test("does not show a React card", async ({ page }) => {
		await openLanding(page);
		const reactCard = page.locator('a[href="react"]');
		await expect(reactCard).toHaveCount(0);
	});

	test("does not show a Self-Hosted card", async ({ page }) => {
		await openLanding(page);
		const selfHostedCard = page.locator('a[href="self-hosted"]');
		await expect(selfHostedCard).toHaveCount(0);
	});

	test("each card navigates to the correct example", async ({ page }) => {
		await openLanding(page);

		const card = page.locator('a[href="cdn-vanilla"]');
		await expect(card).toBeVisible();
		await card.click();
		await page.waitForLoadState("domcontentloaded");
		expect(page.url()).toContain("/cdn-vanilla");
	});

	test("streaming card has an SVG icon instead of emoji", async ({ page }) => {
		await openLanding(page);
		const streamingCard = page.locator('a[href="streaming"]');
		await expect(streamingCard).toBeVisible();
		const svg = streamingCard.locator(".card-icon svg");
		await expect(svg).toBeVisible();
		await expect(streamingCard.locator(".card-title")).toHaveText(/Streaming/);
	});
});
