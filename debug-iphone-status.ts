/**
 * Quick: just read the status message after clicking Stream
 */
import { remote } from "webdriverio";

const UDID = process.env.UDID;
if (!UDID) {
	console.error("Missing UDID");
	process.exit(1);
}
const BASE_URL =
	process.env.SMOKE_BASE_URL ??
	"https://jadujoel.github.io/web-audio-clip-node";

async function main() {
	console.log(`\n🔍 Quick status check — ${BASE_URL}/streaming/\n`);
	const browser = await remote({
		capabilities: {
			browserName: "safari",
			platformName: "iOS",
			"safari:deviceUDID": UDID,
		} as WebdriverIO.Capabilities,
		logLevel: "warn",
		connectionRetryCount: 2,
		connectionRetryTimeout: 60_000,
	});

	try {
		await browser.url(`${BASE_URL}/streaming/`);
		await browser.waitUntil(
			async () =>
				(await browser.execute(() => document.readyState)) === "complete",
			{ timeout: 30_000 },
		);

		// Read initial status
		let status = await browser.execute(() => {
			const ps = document.querySelectorAll("main p");
			return Array.from(ps)
				.map((p) => p.textContent?.trim())
				.filter(Boolean)
				.join(" | ");
		});
		console.log(`  Before click — status: "${status}"`);

		// Click Stream
		const btn = await browser.$("button*=Stream");
		await btn.click();
		console.log("  Clicked Stream");

		// Poll status every 500ms for 10s
		for (let i = 0; i < 20; i++) {
			await browser.pause(500);
			status = await browser.execute(() => {
				const ps = document.querySelectorAll("main p");
				return Array.from(ps)
					.map((p) => p.textContent?.trim())
					.filter(Boolean)
					.join(" | ");
			});
			console.log(`  ${((i + 1) * 0.5).toFixed(1)}s — status: "${status}"`);

			// Also check display section
			if (i % 4 === 3) {
				const display = await browser.execute(() => {
					const outputs = document.querySelectorAll("section#display output");
					return Array.from(outputs)
						.map((o) => o.textContent ?? "")
						.join(" | ");
				});
				console.log(`        display: "${display}"`);
			}
		}
	} catch (err) {
		console.error(`Error: ${err instanceof Error ? err.message : err}`);
	} finally {
		try {
			await browser.deleteSession();
		} catch {}
	}
}
main();
