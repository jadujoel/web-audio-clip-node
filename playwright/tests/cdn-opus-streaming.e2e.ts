import { expect, test } from "@playwright/test";
import {
	injectAudioMonitor,
	measureAudioSustain,
} from "../helpers/audio-monitor";
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

		// CDN version may not have the latest API — skip if the import failed.
		const statusText = await page.locator("#status").textContent();
		if (statusText?.startsWith("Error:")) {
			test.skip(
				true,
				`CDN import failed (likely unpublished API): ${statusText}`,
			);
		}

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

		// CDN tests load from jsdelivr which serves the *published* npm version.
		// If the CDN version is behind the local code, the import may fail and
		// the button will never activate. Detect this and skip gracefully.
		const status = page.locator("#status");
		const statusText = await status.textContent();
		if (statusText?.startsWith("Error:")) {
			test.skip(
				true,
				`CDN import failed (likely unpublished API): ${statusText}`,
			);
		}

		const btn = page.locator("#start");
		await expect(btn).toHaveText("Play");
		await btn.click();

		await expect(btn).toHaveText("Stop", { timeout: 15000 });
		await expect(status).not.toContainText("Error:");
	});

	test("streaming audio does not go silent during playback", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming not supported in headless Firefox",
		);
		test.skip(
			browserName === "webkit",
			"streaming not supported in headless WebKit",
		);
		// CDN module loading + remote audio fetch can be slow
		test.setTimeout(90_000);

		// Inject audio monitor before navigating (must precede any page load)
		await injectAudioMonitor(page);
		await openExample(page, "cdn-opus-streaming");

		// CDN tests load from jsdelivr which serves the *published* npm version.
		const cdnStatus = await page.locator("#status").textContent();
		if (cdnStatus?.startsWith("Error:")) {
			test.skip(
				true,
				`CDN import failed (likely unpublished API): ${cdnStatus}`,
			);
		}

		const btn = page.locator("#start");
		await expect(btn).toBeVisible();

		await btn.click();

		// CDN module may be slow or unavailable — check if status leaves "Idle"
		const statusEl = page.locator("#status");
		let cdnLoaded = true;
		try {
			await expect(statusEl).not.toHaveText("Idle", { timeout: 45000 });
		} catch {
			cdnLoaded = false;
		}
		test.skip(!cdnLoaded, "CDN module did not load — skipping audio test");

		// Wait for actual audio playback to begin
		await expect(page.locator("#status")).toContainText(
			/Streaming|Downloaded/,
			{
				timeout: 30000,
			},
		);

		// Give audio a moment to stabilize, then measure for 5 seconds
		await page.waitForTimeout(500);

		const result = await measureAudioSustain(page, 5000, 100);

		// At least 80% of samples should have audio
		const activeRatio = result.activeSamples / result.totalSamples;
		expect(
			activeRatio,
			`Audio was active for only ${(activeRatio * 100).toFixed(1)}% of samples. ` +
				`RMS values: [${result.rmsValues.map((v) => v.toFixed(4)).join(", ")}]`,
		).toBeGreaterThanOrEqual(0.8);

		// No silence gap longer than 5 consecutive samples (500ms at 100ms interval)
		expect(
			result.longestSilentRun,
			`Longest silent gap was ${result.longestSilentRun} consecutive samples ` +
				`(${result.longestSilentRun * 100}ms). ` +
				`RMS values: [${result.rmsValues.map((v) => v.toFixed(4)).join(", ")}]`,
		).toBeLessThanOrEqual(5);
	});
});
