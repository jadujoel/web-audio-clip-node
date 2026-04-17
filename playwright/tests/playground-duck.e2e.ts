import { expect, test } from "@playwright/test";
import {
	getAudioLevel,
	injectAudioMonitor,
	measureAudioSustain,
} from "../helpers/audio-monitor";
import { openExample } from "../helpers/navigation";

test.describe("Playground ducking", () => {
	test("duck control renders with all parameter rows", async ({ page }) => {
		await openExample(page, "playground");

		const duckControl = page.locator(
			"fieldset:has(legend:has-text('Sidechain Duck'))",
		);
		await expect(duckControl).toBeVisible();

		for (const label of ["Threshold", "Attack", "Release", "Depth"]) {
			await expect(
				duckControl.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}

		// Toggle checkbox exists and is unchecked by default
		const toggle = duckControl.locator("input[type='checkbox']");
		await expect(toggle).toBeVisible();
		await expect(toggle).not.toBeChecked();
	});

	test("enabling duck reveals sidechain kick controls", async ({ page }) => {
		await openExample(page, "playground");

		// Kick section should not be visible while duck is disabled
		await expect(page.locator("legend:has-text('Sidechain Kick')")).toHaveCount(
			0,
		);

		// Enable duck
		const duckToggle = page
			.locator("fieldset:has(legend:has-text('Sidechain Duck'))")
			.locator("input[type='checkbox']");
		await duckToggle.check();

		// Now the kick controls should appear
		const kickSection = page.locator(
			"fieldset:has(legend:has-text('Sidechain Kick'))",
		);
		await expect(kickSection).toBeVisible();
		await expect(
			kickSection.locator("button:has-text('Start Kick')"),
		).toBeVisible();
		await expect(kickSection.locator("text='Hear Kick'")).toBeVisible();
	});

	test("ducking audibly reduces output level when kick sidechain triggers", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"AudioWorklet does not produce output in headless Firefox/WebKit",
		);
		test.setTimeout(45_000);

		// Inject audio monitor BEFORE navigation so we capture the destination connect
		await injectAudioMonitor(page);
		await openExample(page, "playground");

		// Clear any stored state so we get clean defaults
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		await page.waitForLoadState("networkidle");

		// Enable looping so audio volume is sustained and consistent over time
		await page.locator("#loop").check();

		// Start audio playback
		await page.locator("section#buttons button:has-text('Start')").click();

		// Wait until we detect actual audio output
		let audioDetected = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			const level = await getAudioLevel(page);
			if (level && level.rms > 0.01) {
				audioDetected = true;
				break;
			}
			await page.waitForTimeout(200);
		}
		expect(audioDetected).toBe(true);

		// --- Phase 1: Enable ducking but WITHOUT kick ---
		// This way the duck node is in the signal chain but not triggered,
		// giving us a fair baseline through the same audio path.
		const duckControl = page.locator(
			"fieldset:has(legend:has-text('Sidechain Duck'))",
		);
		const duckToggle = duckControl.locator("input[type='checkbox']");
		await duckToggle.check();

		// Configure aggressive ducking settings
		// Depth to 100%
		const depthSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Depth')) [role='slider']",
		);
		await depthSlider.focus();
		await page.keyboard.press("End");

		// Threshold to minimum (-100 dBFS) — very sensitive
		const thresholdSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Threshold')) [role='slider']",
		);
		await thresholdSlider.focus();
		await page.keyboard.press("Home");

		// Shortest attack
		const attackSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Attack')) [role='slider']",
		);
		await attackSlider.focus();
		await page.keyboard.press("Home");

		// Long release so the ducking effect is sustained between kicks
		const releaseSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Release')) [role='slider']",
		);
		await releaseSlider.focus();
		await page.keyboard.press("End");

		// Uncheck "Hear Kick" so kick audio doesn't leak into the output
		const hearKickCheckbox = page.locator("label:has-text('Hear Kick') input");
		await hearKickCheckbox.uncheck();

		// Measure baseline with duck enabled but no kick trigger (no sidechain signal)
		await page.waitForTimeout(500);
		const baseline = await measureAudioSustain(page, 2000, 50, 0.005);
		const baselineAvgRms =
			baseline.rmsValues.reduce((a, b) => a + b, 0) / baseline.rmsValues.length;

		expect(baselineAvgRms).toBeGreaterThan(0.01);

		// --- Phase 2: Start the kick sidechain trigger ---
		const kickButton = page.locator("button:has-text('Start Kick')");
		await kickButton.click();
		await expect(page.locator("button:has-text('Stop Kick')")).toBeVisible();

		// Wait for several kick cycles to establish sustained ducking
		await page.waitForTimeout(2000);

		// Measure audio with ducking actively triggered
		const ducked = await measureAudioSustain(page, 3000, 50, 0.005);
		const duckedAvgRms =
			ducked.rmsValues.reduce((a, b) => a + b, 0) / ducked.rmsValues.length;

		// --- Phase 3: Verify the ducking effect ---

		// The ducked average RMS should be noticeably lower than baseline
		// because the kick sidechain is continuously triggering gain reduction
		expect(duckedAvgRms).toBeLessThan(baselineAvgRms * 0.85);

		// Audio should still be present (not completely silent)
		expect(ducked.activeSamples).toBeGreaterThan(0);
	});

	test("disabling duck bypass restores full volume", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"AudioWorklet does not produce output in headless Firefox/WebKit",
		);
		test.setTimeout(45_000);

		await injectAudioMonitor(page);
		await openExample(page, "playground");
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		await page.waitForLoadState("networkidle");

		// Enable looping for consistent audio
		await page.locator("#loop").check();

		// Start audio playback
		await page.locator("section#buttons button:has-text('Start')").click();

		// Wait for audio to start
		for (let attempt = 0; attempt < 30; attempt++) {
			const level = await getAudioLevel(page);
			if (level && level.rms > 0.01) break;
			await page.waitForTimeout(200);
		}

		// Enable ducking with aggressive settings
		const duckControl = page.locator(
			"fieldset:has(legend:has-text('Sidechain Duck'))",
		);
		const duckToggle = duckControl.locator("input[type='checkbox']");
		await duckToggle.check();

		// Max out depth
		const depthSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Depth')) [role='slider']",
		);
		await depthSlider.focus();
		await page.keyboard.press("End");

		// Min threshold
		const thresholdSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Threshold')) [role='slider']",
		);
		await thresholdSlider.focus();
		await page.keyboard.press("Home");

		// Max release for sustained ducking
		const releaseSlider = duckControl.locator(
			".audio-control:has(.control-label:has-text('Release')) [role='slider']",
		);
		await releaseSlider.focus();
		await page.keyboard.press("End");

		// Disable "Hear Kick" so kick sound doesn't leak into output
		const hearKickCheckbox = page.locator("label:has-text('Hear Kick') input");
		await hearKickCheckbox.uncheck();

		// Start kick
		await page.locator("button:has-text('Start Kick')").click();
		await page.waitForTimeout(2000);

		// Measure ducked audio
		const ducked = await measureAudioSustain(page, 2000, 50, 0.005);
		const duckedAvg =
			ducked.rmsValues.reduce((a, b) => a + b, 0) / ducked.rmsValues.length;

		// Now disable ducking (uncheck the toggle) — this bypasses the duck
		await duckToggle.uncheck();

		// Wait for bypass to take effect and envelope to reset
		await page.waitForTimeout(1000);

		// Measure restored audio
		const restored = await measureAudioSustain(page, 2000, 50, 0.005);
		const restoredAvg =
			restored.rmsValues.reduce((a, b) => a + b, 0) / restored.rmsValues.length;

		// Restored audio should be louder than ducked audio
		expect(restoredAvg).toBeGreaterThan(duckedAvg * 1.1);
	});
});
