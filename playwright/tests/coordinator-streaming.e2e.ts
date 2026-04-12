import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Coordinator streaming example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "coordinator-streaming");
	});

	test("start stream transitions past starting state", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming progress can be flaky in headless Firefox",
		);

		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 15000,
			})
			.not.toBe("Starting stream...");

		await expect(status).not.toContainText("Error:");
	});

	test("download completion transitions to ended without error regression", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"streaming completion timing is flaky in headless Firefox/WebKit",
		);

		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 30000,
			})
			.toBe("Stream Downloaded.");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 10000,
			})
			.toMatch(/^(Stream Downloaded\.|Stream Ended\.)$/);

		await expect(status).not.toContainText("Error:");
	});
});
