import { expect, test } from "@playwright/test";
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
	}) => {
		const streamBtn = page.locator("button:has-text('Stream & Play')");
		const stopBtn = page.locator("button:has-text('Stop')");
		const slider = page.locator(".playhead-slider [role='slider']");

		// First play
		await streamBtn.click();
		// Wait for playhead to advance
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 10000 });

		// Stop
		await stopBtn.click();
		await page.waitForTimeout(500);

		// Second play
		await streamBtn.click();
		// Wait for playhead to advance again (this was the bug — it would freeze)
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 10000 });
	});

	test("selecting RawOpusFramed format populates default URL", async ({
		page,
	}) => {
		const select = page.locator("select#format-select");
		await select.selectOption("RawOpusFramed");

		const urlInput = page.locator("input#url");
		await expect(urlInput).toHaveValue(/\.fopus$/);
	});
});
