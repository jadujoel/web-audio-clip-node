/**
 * Quick diagnostic: Stream FLAC on Playwright WebKit, check actual audio samples.
 */
import { chromium, webkit } from "playwright";

const BASE = "http://127.0.0.1:4175";

async function run(browserType: "webkit" | "chromium") {
	const launcher = browserType === "webkit" ? webkit : chromium;
	const browser = await launcher.launch({ headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();

	// Inject audio monitor BEFORE navigation
	await page.addInitScript(() => {
		const originalConnect = AudioNode.prototype.connect as (
			destination: AudioNode | AudioParam,
			output?: number,
			input?: number,
		) => AudioNode | undefined;
		const win = window as unknown as {
			__audioAnalyser?: AnalyserNode;
			__audioSamples: number[];
		};
		win.__audioSamples = [];

		// biome-ignore lint/suspicious/noExplicitAny: patching overloaded native connect method
		(AudioNode.prototype as any).connect = function (
			destination: AudioNode | AudioParam,
			...rest: number[]
		) {
			if (destination instanceof AudioDestinationNode && !win.__audioAnalyser) {
				const ctx = this.context as AudioContext;
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 2048;
				analyser.smoothingTimeConstant = 0;
				win.__audioAnalyser = analyser;
				originalConnect.call(this, analyser);
				originalConnect.call(analyser, destination);

				// Start polling samples
				const poll = () => {
					if (!win.__audioAnalyser) return;
					const data = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(data);
					const rms = Math.sqrt(
						data.reduce((s, v) => s + v * v, 0) / data.length,
					);
					win.__audioSamples.push(rms);
					requestAnimationFrame(poll);
				};
				requestAnimationFrame(poll);

				return destination;
			}
			return originalConnect.call(this, destination, ...rest);
		};
	});

	await page.goto(`${BASE}/streaming/`);
	await page.waitForLoadState("networkidle");

	// Select FLAC
	await page.evaluate(() => {
		const select = document.querySelector(
			"#format-select",
		) as HTMLSelectElement;
		if (!select) return;
		const nativeSetter = Object.getOwnPropertyDescriptor(
			HTMLSelectElement.prototype,
			"value",
		)?.set;
		if (nativeSetter) nativeSetter.call(select, "Flac");
		else select.value = "Flac";
		select.dispatchEvent(new Event("input", { bubbles: true }));
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await page.waitForTimeout(500);

	// Click Stream
	const streamBtn = page.locator("button:has-text('Stream')").first();
	await streamBtn.click();

	// Wait for Play to be enabled
	const playBtn = page.locator("button:has-text('Play')").first();
	try {
		await playBtn.waitFor({ state: "attached", timeout: 15000 });
		// Wait for it to become enabled
		await page.waitForFunction(
			() => {
				const btns = document.querySelectorAll("button");
				for (const b of btns) {
					if (b.textContent?.includes("Play") && !b.disabled) return true;
				}
				return false;
			},
			{ timeout: 15000 },
		);
		console.log(`  [${browserType}] Play button enabled ✓`);
	} catch {
		// Check display state
		const display = await page.evaluate(() => {
			const outputs = document.querySelectorAll("section#display output");
			return Array.from(outputs)
				.map((o) => o.textContent ?? "")
				.join(" | ");
		});
		const status = await page.evaluate(() => {
			const ps = document.querySelectorAll("p");
			return Array.from(ps)
				.map((p) => p.textContent ?? "")
				.filter(Boolean);
		});
		console.log(`  [${browserType}] Play NOT enabled. Display: ${display}`);
		console.log(`  [${browserType}] Status: ${JSON.stringify(status)}`);

		// Check console errors
		const errors = await page.evaluate(() => {
			return (window as unknown as { __errors?: string[] }).__errors ?? [];
		});
		if (errors.length)
			console.log(`  [${browserType}] Errors: ${JSON.stringify(errors)}`);

		await browser.close();
		return;
	}

	// Click Play
	await playBtn.click();
	console.log(`  [${browserType}] Clicked Play`);

	// Wait 3 seconds and collect audio samples
	await page.waitForTimeout(3000);

	const result = await page.evaluate(() => {
		const win = window as unknown as {
			__audioAnalyser?: AnalyserNode;
			__audioSamples: number[];
		};
		const analyser = win.__audioAnalyser;
		const info: Record<string, unknown> = {
			hasAnalyser: !!analyser,
			sampleCount: win.__audioSamples.length,
			maxRms: Math.max(...win.__audioSamples),
			nonZeroSamples: win.__audioSamples.filter((s) => s > 0.001).length,
			last10: win.__audioSamples.slice(-10),
		};

		// Also check the display state
		const outputs = document.querySelectorAll("section#display output");
		info.display = Array.from(outputs)
			.map((o) => o.textContent ?? "")
			.join(" | ");

		// Check AudioContext state
		const ctxState = document.querySelector(
			"section#display output:nth-child(4)",
		)?.textContent;
		info.nodeState = ctxState;

		return info;
	});

	console.log(`  [${browserType}] Audio analysis:`);
	for (const [k, v] of Object.entries(result)) {
		console.log(`    ${k}: ${JSON.stringify(v)}`);
	}

	const nonZero = result.nonZeroSamples as number;
	if (nonZero > 0) {
		console.log(
			`  [${browserType}] ✅ AUDIO DETECTED (${nonZero} non-zero samples)`,
		);
	} else {
		console.log(`  [${browserType}] ❌ SILENT — no audio samples detected`);
	}

	await browser.close();
}

console.log("\n🔊 Safari (WebKit) Audio Diagnostic\n");

for (const bt of ["chromium", "webkit"] as const) {
	console.log(`\n--- ${bt} ---`);
	try {
		await run(bt);
	} catch (err) {
		console.log(`  [${bt}] ERROR: ${err instanceof Error ? err.message : err}`);
	}
}
