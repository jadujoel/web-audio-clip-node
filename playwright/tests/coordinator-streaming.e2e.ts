import { expect, test } from "@playwright/test";
import {
	injectAudioMonitor,
	measureAudioSustain,
} from "../helpers/audio-monitor";
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

	test("single start click triggers a single audio fetch", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"streaming request timing is flaky in headless Firefox/WebKit",
		);

		let audioFetches = 0;
		page.on("request", (request) => {
			if (
				request.resourceType() === "fetch" &&
				request.url().includes("/sounds/example.opus")
			) {
				audioFetches++;
			}
		});

		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 20000,
			})
			.toMatch(/^(Streaming\.\.\.|Stream Downloaded\.)$/);

		await expect
			.poll(() => audioFetches, {
				timeout: 10000,
			})
			.toBe(1);

		expect(audioFetches).toBe(1);
		await expect(status).not.toContainText("Error:");
	});

	test("streaming playback does not introduce multi-second silence gaps", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"streaming audio analysis is flaky in headless Firefox/WebKit",
		);
		test.setTimeout(90_000);

		await injectAudioMonitor(page);
		await openExample(page, "coordinator-streaming");

		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 20000,
			})
			.toMatch(/^(Streaming\.\.\.|Stream Downloaded\.)$/);

		await page.waitForTimeout(500);
		const result = await measureAudioSustain(page, 8000, 100);

		expect(
			result.longestSilentRun,
			`Detected a long silence gap of ${result.longestSilentRun * 100}ms. RMS: [${result.rmsValues
				.map((v) => v.toFixed(4))
				.join(", ")}]`,
		).toBeLessThanOrEqual(10);
	});

	test("stream does not transition to ended prematurely", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"timing-sensitive stream completion checks are flaky in headless Firefox/WebKit",
		);
		test.setTimeout(90_000);

		const streamUrl =
			"https://jadujoel.github.io/web-audio-clip-node/sounds/example.opus";
		const expectedDuration = await page.evaluate(async (url) => {
			const audio = new Audio(url);
			audio.preload = "metadata";
			await new Promise<void>((resolve, reject) => {
				audio.onloadedmetadata = () => resolve();
				audio.onerror = () => reject(new Error("failed to load metadata"));
			});
			return Number.isFinite(audio.duration) ? audio.duration : 0;
		}, streamUrl);

		const earlyEndGuardSeconds = Math.min(
			20,
			Math.max(6, Math.floor(expectedDuration * 0.45)),
		);

		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 20000,
			})
			.toMatch(/^(Streaming\.\.\.|Stream Downloaded\.)$/);

		await page.waitForTimeout(earlyEndGuardSeconds * 1000);
		await expect(status).not.toContainText("Stream Ended.");
		await expect(status).not.toContainText("Error:");
	});

	test("ended currentTime is near expected opus duration", async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName === "firefox" || browserName === "webkit",
			"timing-sensitive stream completion checks are flaky in headless Firefox/WebKit",
		);
		test.setTimeout(180_000);

		const streamUrl =
			"https://jadujoel.github.io/web-audio-clip-node/sounds/example.opus";
		const expectedDuration = await page.evaluate(async (url) => {
			const audio = new Audio(url);
			audio.preload = "metadata";
			await new Promise<void>((resolve, reject) => {
				audio.onloadedmetadata = () => resolve();
				audio.onerror = () => reject(new Error("failed to load metadata"));
			});
			return Number.isFinite(audio.duration) ? audio.duration : 0;
		}, streamUrl);

		const startedAt = Date.now();
		await page.locator("button#start").click();
		const status = page.locator("#status");

		await expect
			.poll(async () => (await status.textContent())?.trim() ?? "", {
				timeout: 140_000,
			})
			.toBe("Stream Ended.");

		const elapsedSeconds = (Date.now() - startedAt) / 1000;
		expect(elapsedSeconds).toBeGreaterThanOrEqual(expectedDuration * 0.95);
	});
});
