import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Kick synchronization", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "playground");
		// Wait for the default sound to finish loading before interacting
		const soundOutput = page.locator(
			"section#display code:has-text('Sound:') + output",
		);
		await expect(soundOutput).not.toHaveText("none", { timeout: 10_000 });
	});

	test("pressing Start with duck enabled starts both clip and kick", async ({
		page,
	}) => {
		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		// Kick section should be visible and kick not playing
		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);
		await expect(kickSection).toBeVisible();
		await expect(kickSection).toHaveAttribute("data-kick-playing", "false");

		// Press Start
		await page.locator("section#buttons button:has-text('Start')").click();

		// Wait for audio to start
		const stateOutput = page.locator(
			"section#display code:has-text('State:') + output",
		);
		await expect(stateOutput).toHaveText("started", { timeout: 10_000 });

		// Kick should also be playing
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");
	});

	test("pressing Stop stops both clip and kick", async ({ page }) => {
		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		// Enable looping so clip doesn't end on its own
		await page.locator("#loop").check();

		// Start
		await page.locator("section#buttons button:has-text('Start')").click();
		const stateOutput = page.locator(
			"section#display code:has-text('State:') + output",
		);
		await expect(stateOutput).toHaveText("started", { timeout: 10_000 });

		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");

		// Stop
		await page.locator("section#buttons button:has-text('Stop')").click();
		await expect(stateOutput).toHaveText("stopped", { timeout: 5_000 });
		await expect(kickSection).toHaveAttribute("data-kick-playing", "false");
	});

	test("changing tempo while playing does not stop kick", async ({ page }) => {
		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		// Enable looping
		await page.locator("#loop").check();

		// Start
		await page.locator("section#buttons button:has-text('Start')").click();
		const stateOutput = page.locator(
			"section#display code:has-text('State:') + output",
		);
		await expect(stateOutput).toHaveText("started", { timeout: 10_000 });

		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");

		// Change tempo
		const tempoInput = page.locator("#tempo");
		await tempoInput.fill("140");
		await tempoInput.press("Enter");

		// Kick should still be playing
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");
	});

	test("independent Start Kick button works without clip playing", async ({
		page,
	}) => {
		// Start and stop the clip to initialize AudioContext
		await page.locator("section#buttons button:has-text('Start')").click();
		const stateOutput = page.locator(
			"section#display code:has-text('State:') + output",
		);
		await expect(stateOutput).toHaveText("started", { timeout: 10_000 });
		await page.locator("section#buttons button:has-text('Stop')").click();
		await expect(stateOutput).toHaveText("stopped", { timeout: 5_000 });

		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);

		// Click Start Kick independently
		await kickSection.locator("button:has-text('Start Kick')").click();
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");
		await expect(
			kickSection.locator("button:has-text('Stop Kick')"),
		).toBeVisible();

		// Stop Kick
		await kickSection.locator("button:has-text('Stop Kick')").click();
		await expect(kickSection).toHaveAttribute("data-kick-playing", "false");
		await expect(
			kickSection.locator("button:has-text('Start Kick')"),
		).toBeVisible();
	});

	test("pause and resume synchronize clip and kick", async ({ page }) => {
		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		// Enable looping
		await page.locator("#loop").check();

		// Start
		await page.locator("section#buttons button:has-text('Start')").click();
		const stateOutput = page.locator(
			"section#display code:has-text('State:') + output",
		);
		await expect(stateOutput).toHaveText("started", { timeout: 10_000 });

		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");

		// Pause
		await page.locator("section#buttons button:has-text('Pause')").click();
		await expect(stateOutput).toHaveText("paused", { timeout: 5_000 });

		// Resume
		await page.locator("section#buttons button:has-text('Resume')").click();
		await expect(stateOutput).toHaveText("resumed", { timeout: 5_000 });
		await expect(kickSection).toHaveAttribute("data-kick-playing", "true");
	});
});
