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
});
