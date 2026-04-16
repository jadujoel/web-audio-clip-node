import { expect, type Page, test } from "@playwright/test";
import {
	injectAudioMonitor,
	measureAudioSustain,
} from "../helpers/audio-monitor";
import { openExample } from "../helpers/navigation";

function estimateDecodedPcmBytes(seconds: number): number {
	return Math.round(seconds * 48_000 * Float32Array.BYTES_PER_ELEMENT);
}

async function readDecodedSeekableSeconds(page: Page): Promise<number> {
	const locator = page.locator("p").filter({ hasText: /^Decoded seekable:/ });
	if ((await locator.count()) === 0) return 0;
	const text = (await locator.first().textContent()) ?? "";
	const match = text.match(/Decoded seekable:\s*([0-9.]+)s/);
	return match ? Number(match[1]) : 0;
}

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

	test("stream and play buttons render", async ({ page }) => {
		await expect(page.locator("button:has-text('Stream')")).toBeVisible();
		await expect(page.locator("button:has-text('Play')")).toBeVisible();
	});

	test("stream button uses an SVG icon instead of emoji", async ({ page }) => {
		const streamBtn = page
			.locator("button")
			.filter({ hasText: /^Stream$/ })
			.first();
		await expect(streamBtn).toBeVisible();
		await expect(streamBtn.locator("svg")).toBeVisible();
		await expect(streamBtn).not.toContainText("⏬");
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

	test("playhead updates after pressing Stream then Play a second time", async ({
		page,
		browserName,
	}) => {
		// Headless Firefox on CI does not advance the streaming playhead
		test.skip(
			browserName === "firefox",
			"streaming playhead not supported in headless Firefox",
		);

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const stopBtn = page.locator("button:has-text('Stop')");
		const slider = page.locator(".playhead-slider [role='slider']");

		// First stream + play
		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();
		// Wait for playhead to advance
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

		// Stop and wait for audio context to settle
		await stopBtn.click();
		await page.waitForTimeout(1000);

		// Second stream + play
		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();
		// Wait for playhead to advance again (this was the bug — it would freeze)
		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });
	});

	test("shows buffered vs pending playhead regions while streaming", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox",
			"streaming progress timing is unstable in headless Firefox",
		);

		await page.locator("button:has-text('Stream')").first().click();

		const track = page.locator("[data-testid='streaming-playhead-track']");
		await expect(track).toBeVisible();

		await expect(async () => {
			const percent = await track.getAttribute("data-decoded-percent");
			expect(Number(percent ?? "0")).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });
	});

	test("seeking beyond decoded region is blocked while streaming", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"streaming playhead/seek gating is not supported in headless Firefox/WebKit",
		);

		await page.locator("select#throttle-select").selectOption("204800");
		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();

		const slider = page.locator(".playhead-slider [role='slider']");
		await expect(slider).toBeVisible();

		await slider.focus();
		await page.keyboard.press("End");

		await expect
			.poll(async () => {
				const valueNow = Number(await slider.getAttribute("aria-valuenow"));
				const valueMax = Number(await slider.getAttribute("aria-valuemax"));
				return valueNow < valueMax;
			})
			.toBe(true);
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

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const pauseBtn = page.locator("button").filter({ hasText: /Pause|Resume/ });
		const slider = page.locator(".playhead-slider [role='slider']");

		// Start streaming + playback
		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();

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

		// Switch to boomerang
		await loopMode.selectOption("boomerang");
		await expect(loopMode).toHaveValue("boomerang");
	});

	test("persisted boomerang loop mode is applied after reload", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"streaming boomerang verification is not stable in headless Firefox/WebKit",
		);

		await page.evaluate(() => {
			localStorage.setItem(
				"clip-node-state",
				JSON.stringify({
					state: {
						values: {
							loopStart: 0,
							loopEnd: 0.5,
						},
						snaps: {},
						enabled: {},
						mins: {},
						maxs: {},
						maxLocked: {},
						linkedPairs: {},
						loop: true,
						loopMode: "boomerang",
						tempo: 120,
					},
					version: 0,
				}),
			);
		});

		await page.reload();
		await page.waitForLoadState("networkidle");

		await expect(page.locator("#loop")).toBeChecked();
		const loopMode = page.locator("#loopMode");
		await expect(loopMode).toBeVisible();
		await expect(loopMode).toHaveValue("boomerang");

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const slider = page.locator(".playhead-slider [role='slider']");

		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();

		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

		const samples: number[] = [];
		for (let i = 0; i < 20; i++) {
			samples.push(Number(await slider.getAttribute("aria-valuenow")));
			await page.waitForTimeout(120);
		}

		expect(Math.max(...samples)).toBeGreaterThan(20_000);

		let descendingRun = 0;
		let maxDescendingRun = 0;
		for (let i = 1; i < samples.length; i++) {
			if (samples[i] < samples[i - 1] - 400) {
				descendingRun += 1;
				maxDescendingRun = Math.max(maxDescendingRun, descendingRun);
			} else {
				descendingRun = 0;
			}
		}

		expect(
			maxDescendingRun,
			`expected boomerang playback after reload, got playhead samples: ${samples.join(", ")}`,
		).toBeGreaterThanOrEqual(2);
	});

	test("stop silences playback promptly even with long stop settings", async ({
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

		await injectAudioMonitor(page);
		await page.addInitScript(() => {
			localStorage.setItem(
				"clip-node-state",
				JSON.stringify({
					state: {
						values: {
							stopDelay: 4,
							fadeOut: 4,
						},
						enabled: {
							stopDelay: true,
							fadeOut: true,
						},
					},
					version: 0,
				}),
			);
		});
		await openExample(page, "streaming");

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const stopBtn = page.locator("button:has-text('Stop')").first();
		const slider = page.locator(".playhead-slider [role='slider']");

		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();

		await expect(async () => {
			const val = Number(await slider.getAttribute("aria-valuenow"));
			expect(val).toBeGreaterThan(0);
		}).toPass({ timeout: 15000 });

		await stopBtn.click();

		const result = await measureAudioSustain(page, 1200, 100);
		const activeRatio = result.activeSamples / result.totalSamples;
		expect(
			activeRatio,
			`Audio stayed active for ${(activeRatio * 100).toFixed(1)}% of samples after Stop. ` +
				`RMS values: [${result.rmsValues.map((v) => v.toFixed(4)).join(", ")}]`,
		).toBeLessThanOrEqual(0.25);
	});

	test("decoded PCM memory profile grows while streaming and resets after dispose", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName !== "chromium",
			"decoded memory profile regression is validated in Chromium",
		);
		test.setTimeout(90_000);

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const disposeBtn = page.locator("button:has-text('Dispose')").first();
		const decodedSeekable = page
			.locator("p")
			.filter({ hasText: /^Decoded seekable:/ });

		expect(
			estimateDecodedPcmBytes(await readDecodedSeekableSeconds(page)),
		).toBe(0);

		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15_000 });
		await playBtn.click();

		await expect
			.poll(
				async () =>
					estimateDecodedPcmBytes(await readDecodedSeekableSeconds(page)),
				{
					timeout: 15_000,
				},
			)
			.toBeGreaterThan(128 * 1024);

		const streamingBytes = estimateDecodedPcmBytes(
			await readDecodedSeekableSeconds(page),
		);
		expect(streamingBytes).toBeGreaterThan(128 * 1024);

		await disposeBtn.click();
		await expect(page.locator("section#display")).toContainText("disposed");
		await expect(decodedSeekable).toHaveCount(0);
		expect(
			estimateDecodedPcmBytes(await readDecodedSeekableSeconds(page)),
		).toBe(0);
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

		const streamBtn = page.locator("button:has-text('Stream')").first();
		const playBtn = page.locator("button:has-text('Play')").first();
		const slider = page.locator(".playhead-slider [role='slider']");

		await streamBtn.click();
		await expect(playBtn).toBeEnabled({ timeout: 15000 });
		await playBtn.click();

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
