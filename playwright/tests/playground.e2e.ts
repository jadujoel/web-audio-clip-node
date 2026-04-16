import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

test.describe("Playground example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "playground");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/playground/i);
		expect(errors).toEqual([]);
	});

	test("display panel renders with initial state", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		const stateOutput = display.locator("code:has-text('State:') + output");
		await expect(stateOutput).toBeVisible();
		await expect(stateOutput).toHaveText("initial");
	});

	test("transport buttons section renders", async ({ page }) => {
		const buttons = page.locator("section#buttons");
		await expect(buttons).toBeVisible();

		await expect(
			buttons.locator("button:has-text('Load Sound')"),
		).toBeVisible();
		await expect(buttons.locator("button:has-text('Start')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Stop')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Pause')")).toBeVisible();
		await expect(buttons.locator("button:has-text('Resume')")).toBeVisible();
	});

	test("transport buttons have correct disabled states initially", async ({
		page,
	}) => {
		const buttons = page.locator("section#buttons");

		await expect(
			buttons.locator("button:has-text('Load Sound')"),
		).toBeEnabled();
		await expect(buttons.locator("button:has-text('Start')")).toBeEnabled();
		await expect(buttons.locator("button:has-text('Stop')")).toBeDisabled();
		await expect(buttons.locator("button:has-text('Pause')")).toBeDisabled();
		await expect(buttons.locator("button:has-text('Resume')")).toBeDisabled();
	});

	test("controls section renders with parameter controls", async ({ page }) => {
		const controls = page.locator("section#controls");
		await expect(controls).toBeVisible();

		for (const label of ["Rate", "Detune", "Gain", "Pan"]) {
			await expect(
				controls.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});

	test("parameter sliders are interactive", async ({ page }) => {
		const rateControl = page.locator(
			".audio-control:has(.control-label:has-text('Rate'))",
		);
		const slider = rateControl.locator("[role='slider']");
		await expect(slider).toBeVisible();
		await expect(slider).toHaveAttribute("aria-valuenow");

		const output = rateControl.locator(".control-output");
		await expect(output).toBeVisible();
		await expect(output).toHaveText(/x$/);
	});

	test("gain control shows dB value", async ({ page }) => {
		const gainControl = page.locator(
			".audio-control:has(.control-label:has-text('Gain'))",
		);
		const output = gainControl.locator(".control-output");
		await expect(output).toBeVisible();
		await expect(output).toHaveText(/dB$/);
	});

	test("playhead slider renders", async ({ page }) => {
		const playhead = page.locator(".playhead-slider");
		await expect(playhead).toBeVisible();

		const slider = playhead.locator("[role='slider']");
		await expect(slider).toBeVisible();

		const time = playhead.locator(".playhead-time");
		await expect(time).toBeVisible();
	});

	test("tempo input renders with default value", async ({ page }) => {
		const tempo = page.locator("input#tempo");
		await expect(tempo).toBeVisible();
		await expect(tempo).toHaveAttribute("type", "number");
	});

	test("loop checkbox renders", async ({ page }) => {
		const loop = page.locator("input#loop");
		await expect(loop).toBeVisible();
		await expect(loop).toHaveAttribute("type", "checkbox");
	});

	test("debug row is visible by default without expander", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		const frameLabel = display.locator("code:has-text('Frame:')");
		await expect(frameLabel).toBeVisible();

		const latencyLabel = display.locator("code:has-text('Latency:')");
		await expect(latencyLabel).toBeVisible();

		await expect(display.locator("details")).toHaveCount(0);
		await expect(display.locator("summary")).toHaveCount(0);
	});

	test("filter controls render", async ({ page }) => {
		for (const label of ["Lowpass", "Highpass"]) {
			await expect(
				page.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});

	test("loads without errors when localStorage has stale state missing keys", async ({
		page,
	}) => {
		// Seed localStorage with a partial state that is missing newer keys
		// (simulates a user who visited before new controls were added)
		await page.evaluate(() => {
			const stale = {
				state: {
					values: { gain: -3, pan: 0.5, playbackRate: 1, detune: 0 },
					snaps: {},
					enabled: {},
					mins: {},
					maxs: {},
					maxLocked: {},
					linkedPairs: {},
					loop: false,
					loopMode: "forward",
					tempo: 120,
				},
				version: 0,
			};
			localStorage.setItem("clip-node-state", JSON.stringify(stale));
		});

		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		await page.reload();
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveTitle(/playground/i);
		await expect(page.locator("section#display")).toBeVisible();
		await expect(page.locator("section#buttons")).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("loop mode dropdown appears when loop is enabled", async ({ page }) => {
		const loopCheckbox = page.locator("#loop");
		await expect(loopCheckbox).toBeVisible();

		// Loop mode dropdown should not be visible initially
		await expect(page.locator("#loopMode")).toHaveCount(0);

		// Enable loop
		await loopCheckbox.check();

		// Now the loop mode dropdown should appear
		const loopMode = page.locator("#loopMode");
		await expect(loopMode).toBeVisible();
		await expect(loopMode).toHaveValue("forward");

		// Switch to boomerang
		await loopMode.selectOption("boomerang");
		await expect(loopMode).toHaveValue("boomerang");
	});

	test("crossfade controls are disabled in boomerang mode", async ({
		page,
	}) => {
		await page.locator("#loop").check();
		const loopMode = page.locator("#loopMode");

		const crossfadeControl = page.locator(".audio-control").filter({
			has: page.locator(".control-label", { hasText: /^Crossfade$/ }),
		});
		const crossfadeSlider = crossfadeControl.locator("[role='slider']");
		const crossfadeToggle = crossfadeControl.locator(".control-toggle");

		await expect(crossfadeSlider).not.toHaveAttribute("aria-disabled", "true");
		await expect(crossfadeToggle).toBeEnabled();

		await loopMode.selectOption("boomerang");
		await expect(loopMode).toHaveValue("boomerang");

		await expect(crossfadeControl).toHaveClass(/audio-control--disabled/);
		await expect(crossfadeSlider).toHaveAttribute("aria-disabled", "true");
		await expect(crossfadeToggle).toBeDisabled();
	});

	test("crossfade value is preserved when leaving boomerang mode", async ({
		page,
	}) => {
		await page.locator("#loop").check();
		const loopMode = page.locator("#loopMode");

		const crossfadeControl = page.locator(".audio-control").filter({
			has: page.locator(".control-label", { hasText: /^Crossfade$/ }),
		});
		const crossfadeSlider = crossfadeControl.locator("[role='slider']");

		await crossfadeSlider.focus();
		await page.keyboard.press("ArrowRight");

		const valueBeforeBoomerang =
			await crossfadeSlider.getAttribute("aria-valuenow");
		expect(valueBeforeBoomerang).toBeTruthy();

		await loopMode.selectOption("boomerang");
		await expect(crossfadeSlider).toHaveAttribute("aria-disabled", "true");

		await loopMode.selectOption("forward");
		await expect(loopMode).toHaveValue("forward");
		await expect(crossfadeSlider).not.toHaveAttribute("aria-disabled", "true");

		const valueAfterForward =
			await crossfadeSlider.getAttribute("aria-valuenow");
		expect(valueAfterForward).toBe(valueBeforeBoomerang);
	});

	test("pause then delayed stop never resumes before ending", async ({
		page,
	}) => {
		test.setTimeout(45_000);

		const fileChooserPromise = page.waitForEvent("filechooser");
		await page.locator("section#buttons button:has-text('Load Sound')").click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(
			resolve(import.meta.dirname, "../../src/sounds/example.mp3"),
		);

		const soundOutput = page.locator("code:has-text('Sound:') + output");
		await expect(soundOutput).toContainText("example.mp3");

		const stopDelaySlider = page
			.locator(".audio-control")
			.filter({
				has: page.locator(".control-label", { hasText: /^StopDelay$/ }),
			})
			.locator("[role='slider']");
		await stopDelaySlider.focus();
		await page.keyboard.press("PageUp");
		await expect
			.poll(async () =>
				Number(await stopDelaySlider.getAttribute("aria-valuenow")),
			)
			.toBeGreaterThan(0);

		const stateOutput = page.locator("code:has-text('State:') + output");
		const startButton = page.locator(
			"section#buttons button:has-text('Start')",
		);
		const pauseButton = page.locator(
			"section#buttons button:has-text('Pause')",
		);
		const stopButton = page.locator("section#buttons button:has-text('Stop')");

		await startButton.click();
		await expect
			.poll(async () => (await stateOutput.textContent())?.trim() ?? "")
			.toBe("started");

		await expect(pauseButton).toBeEnabled();
		await pauseButton.click();
		await expect(stateOutput).toHaveText("paused");

		await stopButton.click();
		await expect(stateOutput).toHaveText("stopped");

		const sampledStates: string[] = [];
		for (let i = 0; i < 10; i++) {
			sampledStates.push(
				((await stateOutput.textContent()) ?? "").trim().toLowerCase(),
			);
			await page.waitForTimeout(100);
		}

		expect(sampledStates).not.toContain("started");
		expect(sampledStates).not.toContain("resumed");

		await expect
			.poll(async () => (await stateOutput.textContent())?.trim() ?? "", {
				timeout: 10_000,
			})
			.toBe("ended");
	});
});
