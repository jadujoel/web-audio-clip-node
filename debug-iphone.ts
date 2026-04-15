/**
 * Diagnostic script: open the streaming page on iPhone Safari,
 * inject a console/error collector, and capture logs at every step
 * (before clicking Stream, after clicking Stream, etc.)
 */
import { remote } from "webdriverio";

const UDID = process.env.UDID;
if (!UDID) {
	console.error("Missing UDID. Set it in .env");
	process.exit(1);
}

const BASE_URL =
	process.env.SMOKE_BASE_URL ??
	"https://jadujoel.github.io/web-audio-clip-node";

async function injectCollector(browser: WebdriverIO.Browser) {
	await browser.execute(() => {
		const w = window as unknown as Record<string, unknown>;
		w.__smokeErrors = [] as string[];
		w.__smokeLogs = [] as { level: string; args: string; timestamp: number }[];
		window.addEventListener("error", (e) => {
			(w.__smokeErrors as string[]).push(e.message);
			(
				w.__smokeLogs as { level: string; args: string; timestamp: number }[]
			).push({
				level: "error",
				args: `[uncaught] ${e.message} (${e.filename}:${e.lineno}:${e.colno})`,
				timestamp: Date.now(),
			});
		});
		window.addEventListener("unhandledrejection", (e) => {
			const reason =
				e.reason instanceof Error
					? `${e.reason.message}\n${e.reason.stack}`
					: String(e.reason);
			(w.__smokeErrors as string[]).push(reason);
			(
				w.__smokeLogs as { level: string; args: string; timestamp: number }[]
			).push({
				level: "error",
				args: `[unhandledrejection] ${reason}`,
				timestamp: Date.now(),
			});
		});
		for (const level of ["log", "info", "warn", "error"] as const) {
			const original = console[level].bind(console);
			console[level] = (...args: unknown[]) => {
				(
					w.__smokeLogs as { level: string; args: string; timestamp: number }[]
				).push({
					level,
					args: args
						.map((a) => {
							try {
								return typeof a === "object" ? JSON.stringify(a) : String(a);
							} catch {
								return String(a);
							}
						})
						.join(" "),
					timestamp: Date.now(),
				});
				original(...args);
			};
		}
	});
}

async function collectLogs(
	browser: WebdriverIO.Browser,
): Promise<{ level: string; args: string; timestamp: number }[]> {
	try {
		return await browser.execute(() => {
			const w = window as unknown as Record<string, unknown>;
			return (
				(w.__smokeLogs as {
					level: string;
					args: string;
					timestamp: number;
				}[]) ?? []
			);
		});
	} catch (e) {
		console.log(
			`  ⚠ Could not collect logs: ${e instanceof Error ? e.message : e}`,
		);
		return [];
	}
}

async function collectErrors(browser: WebdriverIO.Browser): Promise<string[]> {
	try {
		return await browser.execute(() => {
			const w = window as unknown as Record<string, unknown>;
			return (w.__smokeErrors as string[]) ?? [];
		});
	} catch (e) {
		console.log(
			`  ⚠ Could not collect errors: ${e instanceof Error ? e.message : e}`,
		);
		return [];
	}
}

function printLogs(
	logs: { level: string; args: string; timestamp: number }[],
	label: string,
) {
	console.log(`\n  📋 ${label} (${logs.length} entries):`);
	if (logs.length === 0) {
		console.log("    (none)");
		return;
	}
	for (const log of logs) {
		const ts = new Date(log.timestamp).toISOString().split("T")[1];
		const icon =
			log.level === "error" ? "❌" : log.level === "warn" ? "⚠️" : "ℹ️";
		console.log(`    ${icon} [${ts}] [${log.level}] ${log.args}`);
	}
}

async function main() {
	console.log(`\n🔍 iPhone Streaming Debug`);
	console.log(`   UDID: ${UDID}`);
	console.log(`   Base URL: ${BASE_URL}\n`);

	let browser: WebdriverIO.Browser | undefined;

	try {
		console.log("⏳ Creating Safari session on iPhone...");
		browser = await remote({
			capabilities: {
				browserName: "safari",
				platformName: "iOS",
				"safari:deviceUDID": UDID,
			} as WebdriverIO.Capabilities,
			logLevel: "warn",
			connectionRetryCount: 2,
			connectionRetryTimeout: 60_000,
		});
		console.log(`✅ Session created (${browser.sessionId})\n`);

		// Step 1: Navigate to streaming page
		console.log("  1️⃣  Navigating to streaming page...");
		await browser.url(`${BASE_URL}/streaming/`);
		await browser.waitUntil(
			async () =>
				(await browser.execute(() => document.readyState)) === "complete",
			{ timeout: 30_000, timeoutMsg: "Page did not load" },
		);
		console.log("  ✅ Page loaded");

		// Step 2: Inject collector
		console.log("  2️⃣  Injecting console/error collector...");
		await injectCollector(browser);
		console.log("  ✅ Collector injected");

		// Step 3: Wait a moment and collect any initial errors
		await browser.pause(2000);
		let logs = await collectLogs(browser);
		printLogs(logs, "After page load (2s)");

		// Step 4: Check what's visible on the page
		const pageInfo = await browser.execute(() => {
			const info: Record<string, string> = {};
			const select = document.querySelector(
				"#format-select",
			) as HTMLSelectElement;
			info.format = select?.value ?? "N/A";
			const urlInput = document.querySelector("#url") as HTMLInputElement;
			info.url = urlInput?.value ?? "N/A";
			const outputs = document.querySelectorAll("section#display output");
			info.display = Array.from(outputs)
				.map((o) => o.textContent ?? "")
				.join(" | ");
			info.title = document.title;
			// Check for AudioDecoder
			info.hasAudioDecoder = String(
				typeof (globalThis as any).AudioDecoder !== "undefined",
			);
			// Check for polyfill script load capability
			info.userAgent = navigator.userAgent;
			return info;
		});
		console.log("\n  📊 Page state:");
		for (const [k, v] of Object.entries(pageInfo)) {
			console.log(`    ${k}: ${v}`);
		}

		// Step 5: Select Flac format (same as smoke test)
		console.log("\n  3️⃣  Selecting Flac format...");
		await browser.execute(() => {
			const select = document.querySelector(
				"#format-select",
			) as HTMLSelectElement;
			if (!select) return;
			const nativeSetter = Object.getOwnPropertyDescriptor(
				HTMLSelectElement.prototype,
				"value",
			)?.set;
			if (nativeSetter) {
				nativeSetter.call(select, "Flac");
			} else {
				select.value = "Flac";
			}
			select.dispatchEvent(new Event("input", { bubbles: true }));
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await browser.pause(1000);

		const afterSelect = await browser.execute(() => {
			const select = document.querySelector(
				"#format-select",
			) as HTMLSelectElement;
			const urlInput = document.querySelector("#url") as HTMLInputElement;
			return { format: select?.value, url: urlInput?.value };
		});
		console.log(`  ✅ Format: ${afterSelect.format}, URL: ${afterSelect.url}`);

		logs = await collectLogs(browser);
		printLogs(logs, "After format select");

		// Step 6: Click Stream button — try both WebDriver click and JS click
		console.log("\n  4️⃣  Clicking Stream button via JS dispatch...");

		// First, try clicking via JS to ensure the React handler fires
		const clickResult = await browser.execute(() => {
			try {
				const buttons = document.querySelectorAll("button");
				for (const btn of buttons) {
					if (btn.textContent && btn.textContent.includes("Stream")) {
						// Check if button is disabled
						const info = {
							text: btn.textContent,
							disabled: btn.disabled,
							onclick: typeof (btn as any).onclick,
							listeners: "unknown",
						};
						btn.click();
						return { found: true, clicked: true, info };
					}
				}
				return { found: false, clicked: false, info: null };
			} catch (e) {
				return { found: false, clicked: false, error: String(e) };
			}
		});
		console.log(`  Button click result: ${JSON.stringify(clickResult)}`);

		await browser.pause(1000);
		logs = await collectLogs(browser);
		printLogs(logs, "1s after JS click");

		// Check status text (the <p> element that shows stream status)
		const statusAfterClick = await browser.execute(() => {
			const ps = document.querySelectorAll("p");
			return Array.from(ps)
				.map((p) => p.textContent ?? "")
				.filter(Boolean);
		});
		console.log(
			`\n  📝 Status text after click: ${JSON.stringify(statusAfterClick)}`,
		);

		// Step 7: Try to directly test AudioContext + AudioWorklet
		console.log("\n  5️⃣  Testing AudioContext + AudioWorklet support...");
		const audioTest = await browser.execute(async () => {
			const results: Record<string, string> = {};
			try {
				const AudioCtx =
					(window as any).AudioContext || (window as any).webkitAudioContext;
				results.audioContextType = AudioCtx
					? AudioCtx.name || "exists"
					: "missing";
				const ctx = new AudioCtx({ sampleRate: 48000 });
				results.contextState = ctx.state;
				results.sampleRate = String(ctx.sampleRate);

				// Test audioWorklet
				results.hasAudioWorklet = String(!!ctx.audioWorklet);
				results.hasAddModule = String(
					typeof ctx.audioWorklet?.addModule === "function",
				);

				// Try resuming
				try {
					await ctx.resume();
					results.resumeState = ctx.state;
				} catch (e) {
					results.resumeError = String(e);
				}

				// Test Worker support
				try {
					const blob = new Blob(["self.postMessage('ok')"], {
						type: "application/javascript",
					});
					const url = URL.createObjectURL(blob);
					const w = new Worker(url);
					const workerResult = await new Promise<string>((resolve, reject) => {
						w.onmessage = (e) => resolve(String(e.data));
						w.onerror = (e) => reject(e.message);
						setTimeout(() => reject("timeout"), 3000);
					});
					results.workerSupport = workerResult;
					w.terminate();
					URL.revokeObjectURL(url);
				} catch (e) {
					results.workerError = String(e);
				}

				// Test if we can create a blob worker with importScripts
				results.hasImportScripts = String(typeof (self as any).importScripts);

				ctx.close();
			} catch (e) {
				results.error = String(e);
			}
			return results;
		});
		console.log("  🔊 Audio/Worker capabilities:");
		for (const [k, v] of Object.entries(audioTest)) {
			console.log(`    ${k}: ${v}`);
		}

		// Step 8: Try creating and running the actual stream manually
		console.log("\n  6️⃣  Manually triggering stream via React internals...");
		const manualStream = await browser.execute(async () => {
			const results: string[] = [];
			try {
				// Find the Stream button and simulate a proper React click event
				const buttons = document.querySelectorAll("button");
				let streamBtn: HTMLButtonElement | null = null;
				for (const btn of buttons) {
					if (btn.textContent && btn.textContent.includes("Stream")) {
						streamBtn = btn;
						break;
					}
				}
				if (!streamBtn) {
					results.push("ERROR: Stream button not found");
					return results;
				}

				results.push(
					`Button found: "${streamBtn.textContent}", disabled=${streamBtn.disabled}`,
				);

				// Use a MouseEvent to better simulate a real click for React
				const mouseEvent = new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					view: window,
				});
				streamBtn.dispatchEvent(mouseEvent);
				results.push("Dispatched MouseEvent click");

				// Wait 2 seconds to let the async stream function run
				await new Promise((resolve) => setTimeout(resolve, 2000));

				// Check display state
				const outputs = document.querySelectorAll("section#display output");
				const display = Array.from(outputs)
					.map((o) => o.textContent ?? "")
					.join(" | ");
				results.push(`Display: ${display}`);

				// Check status messages
				const ps = document.querySelectorAll("p");
				const status = Array.from(ps)
					.map((p) => p.textContent ?? "")
					.filter(Boolean);
				results.push(`Status: ${JSON.stringify(status)}`);
			} catch (e) {
				results.push(
					`ERROR: ${e instanceof Error ? e.message + "\n" + e.stack : String(e)}`,
				);
			}
			return results;
		});
		console.log("  Manual stream attempt:");
		for (const line of manualStream) {
			console.log(`    ${line}`);
		}

		// Wait and collect all logs
		await browser.pause(3000);
		logs = await collectLogs(browser);
		printLogs(logs, "Final logs after all attempts");

		const errors = await collectErrors(browser);
		if (errors.length > 0) {
			console.log("\n  ❌ Errors collected:");
			for (const e of errors) console.log(`    ${e}`);
		}

		// Final display check
		const displayFinal = await browser.execute(() => {
			const outputs = document.querySelectorAll("section#display output");
			return Array.from(outputs)
				.map((o) => o.textContent ?? "")
				.join(" | ");
		});
		console.log(`\n  📡 Final display: ${displayFinal}`);

		console.log("\n✅ Debug session complete");
	} catch (err) {
		console.error(
			`\n❌ Session error: ${err instanceof Error ? err.message : err}`,
		);
		if (err instanceof Error && err.stack) {
			console.error(err.stack);
		}
		// Try one last log collection
		if (browser) {
			const logs = await collectLogs(browser);
			printLogs(logs, "Logs at crash");
		}
	} finally {
		if (browser) {
			try {
				await browser.deleteSession();
			} catch {
				/* session may already be dead */
			}
		}
	}
}

main();
