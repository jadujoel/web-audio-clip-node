import type { Page } from "@playwright/test";

/** Navigate to a sub-example by path (e.g. "cdn-vanilla"). */
export async function openExample(page: Page, name: string): Promise<void> {
	await page.goto(`/${name}`);
	await page.waitForLoadState("networkidle");
}

/** Navigate to the landing page. */
export async function openLanding(page: Page): Promise<void> {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
}
