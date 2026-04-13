import { expect, test } from "@playwright/test";
import {
	injectAudioMonitor,
	measureAudioSustain,
} from "../helpers/audio-monitor";
import { openExample } from "../helpers/navigation";

test.describe("Streaming example", () => {
	test.beforeEach(async ({ page }) => {
		await openExample(page, "streaming");
	});

	test("page loads with correct title and no errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));
		await expect(page).toHaveTitle(/stream/i);
		expect(errors).toEqual([]);
	});

	test("heading renders", async ({ page }) => {
		await expect(page.locator("h1")).toContainText("Streaming");
	});

	test("format selector renders with options", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const options = select.locator("option");
		const count = await options.count();
		expect(count).toBeGreaterThanOrEqual(3);
	});

	test("format selector includes AAC (ADTS) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const aacOption = select.locator("option[value='Aac']");
		await expect(aacOption).toBeAttached();
		await expect(aacOption).toHaveText("AAC (ADTS)");
	});

	test("selecting AAC format updates URL to .aac", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("Aac");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.aac$/);
	});

	test("format selector includes AAC (MP4/M4A) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const mp4Option = select.locator("option[value='Mp4Aac']");
		await expect(mp4Option).toBeAttached();
		await expect(mp4Option).toHaveText("AAC (MP4/M4A)");
	});

	test("selecting Mp4Aac format updates URL to .m4a", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("Mp4Aac");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.m4a$/);
	});

	test("format selector includes Vorbis (Ogg) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const vorbisOggOption = select.locator("option[value='OggVorbis']");
		await expect(vorbisOggOption).toBeAttached();
		await expect(vorbisOggOption).toHaveText("Vorbis (Ogg)");
	});

	test("selecting OggVorbis format updates URL to .ogg", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("OggVorbis");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.ogg$/);
	});

	test("format selector includes FLAC (Lossless) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const flacOption = select.locator("option[value='Flac']");
		await expect(flacOption).toBeAttached();
		await expect(flacOption).toHaveText("FLAC (Lossless)");
	});

	test("selecting Flac format updates URL to .flac", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("Flac");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.flac$/);
	});

	test("format selector includes FLAC (OGG) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const oggFlacOption = select.locator("option[value='OggFlac']");
		await expect(oggFlacOption).toBeAttached();
		await expect(oggFlacOption).toHaveText("FLAC (OGG)");
	});

	test("selecting OggFlac format updates URL to .oga", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("OggFlac");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.oga$/);
	});

	test("format selector includes Vorbis (WebM) option", async ({ page }) => {
		const select = page.locator("select#format-select");
		await expect(select).toBeVisible();

		const vorbisWebmOption = select.locator("option[value='WebmVorbis']");
		await expect(vorbisWebmOption).toBeAttached();
		await expect(vorbisWebmOption).toHaveText("Vorbis (WebM)");
	});

	test("selecting WebmVorbis format updates URL to .webm", async ({ page }) => {
		const select = page.locator("select#format-select");
		await select.selectOption("WebmVorbis");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.webm$/);
	});

	test("audio URL input renders", async ({ page }) => {
		const input = page.locator("input#url");
		await expect(input).toBeVisible();
		await expect(input).toHaveAttribute("type", "text");
	});

	test("stream & play button renders", async ({ page }) => {
		await expect(
			page.locator("button:has-text('Stream & Play')"),
		).toBeVisible();
	});

	test("pause and stop buttons render", async ({ page }) => {
		await expect(page.locator("button:has-text('Pause')")).toBeVisible();
		await expect(page.locator("button:has-text('Stop')")).toBeVisible();
	});

	test("pause button shows Pause initially, not Resume", async ({ page }) => {
		const pauseBtn = page.locator("button").filter({ hasText: /Pause|Resume/ });
		await expect(pauseBtn).toBeVisible();
		await expect(pauseBtn).toContainText("Pause");
	});

	test("display panel renders with initial state", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		const stateOutput = display.locator("code:has-text('State:') + output");
		await expect(stateOutput).toBeVisible();
		await expect(stateOutput).toHaveText("initial");
	});

	test("debug row is visible by default without expander", async ({ page }) => {
		const display = page.locator("section#display");
		await expect(display).toBeVisible();

		// Debug row should be visible without needing to click an expander
		const frameLabel = display.locator("code:has-text('Frame:')");
		await expect(frameLabel).toBeVisible();

		const latencyLabel = display.locator("code:has-text('Latency:')");
		await expect(latencyLabel).toBeVisible();

		// No <details> or <summary> elements should exist
		await expect(display.locator("details")).toHaveCount(0);
		await expect(display.locator("summary")).toHaveCount(0);
	});

	test("parameter controls render", async ({ page }) => {
		for (const label of ["Rate", "Gain"]) {
			await expect(
				page.locator(`.control-label:has-text('${label}')`),
			).toBeVisible();
		}
	});

	test("playhead slider renders", async ({ page }) => {
		const playhead = page.locator(".playhead-slider");
		await expect(playhead).toBeVisible();
	});

	test("tempo input renders", async ({ page }) => {
		const tempo = page.locator("input#tempo");
		await expect(tempo).toBeVisible();
	});

	test("network speed selector renders", async ({ page }) => {
		const throttle = page.locator("select#throttle-select");
		await expect(throttle).toBeVisible();
	});

	test("playhead starts at zero and does not regress without playback", async ({
		page,
	}) => {
		const slider = page.locator(".playhead-slider [role='slider']");
		await expect(slider).toBeVisible();

		// Read initial value
		const initial = await slider.getAttribute("aria-valuenow");
		expect(Number(initial)).toBe(0);

		// Wait briefly and confirm it hasn't moved backwards
		await page.waitForTimeout(200);
		const after = await slider.getAttribute("aria-valuenow");
		expect(Number(after)).toBeGreaterThanOrEqual(0);
		expect(Number(after)).toBe(0);
	});

	test("playhead updates after pressing Stream & Play a second time", async ({
		page,
		browserName,
	}) => {
		// Headless Firefox on CI does not advance the streaming playhead
		test.skip(
			browserName === "firefox",
			"streaming playhead not supported in headless Firefox",
		);

		const streamBtn = page.locator("button:has-text('Stream & Play')");
		const stopBtn = page.locator("button:has-text('Stop')");
		const slider = page.locator(".playhead-slider [role='slider']");

		// First play
		await streamBtn.click();
		// Wait for playhead to advance
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

		// Stop and wait for audio context to settle
		await stopBtn.click();
		await page.waitForTimeout(1000);

		// Second play
		await streamBtn.click();
		// Wait for playhead to advance again (this was the bug — it would freeze)
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });
	});

	test("selecting RawOpusFramed format populates default URL", async ({
		page,
	}) => {
		const select = page.locator("select#format-select");
		await select.selectOption("RawOpusFramed");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.fopus$/);
	});

	test("resume continues from paused position instead of restarting", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming playhead not supported in headless Firefox",
		);

		const streamBtn = page.locator("button:has-text('Stream & Play')");
		const pauseBtn = page.locator("button").filter({ hasText: /Pause|Resume/ });
		const slider = page.locator(".playhead-slider [role='slider']");

		// Start streaming playback
		await streamBtn.click();

		// Wait for playhead to advance past 0
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

		// Pause
		await pauseBtn.click();
		await page.waitForTimeout(500);

		// Record the paused playhead value
		const pausedValue = Number(await slider.getAttribute("aria-valuenow"));
		expect(pausedValue).toBeGreaterThan(0);

		// Resume
		await pauseBtn.click();
		await page.waitForTimeout(500);

		// Verify playhead is >= the paused value (not reset to 0)
		const resumedValue = Number(await slider.getAttribute("aria-valuenow"));
		expect(resumedValue).toBeGreaterThanOrEqual(pausedValue);
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

		// Switch to ping-pong
		await loopMode.selectOption("ping-pong");
		await expect(loopMode).toHaveValue("ping-pong");
	});

	test("streaming audio does not go silent during playback", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming playhead not supported in headless Firefox",
		);
		test.skip(
			browserName === "webkit",
			"streaming playhead not supported in headless WebKit",
		);

		// Inject audio monitor before navigating
		await injectAudioMonitor(page);
		await openExample(page, "streaming");

		const streamBtn = page.locator("button:has-text('Stream & Play')");
		const slider = page.locator(".playhead-slider [role='slider']");

		await streamBtn.click();

		// Wait for playhead to advance (audio has started)
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

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
