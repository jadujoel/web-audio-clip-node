import { remote } from "webdriverio";
import targets from "./webdriver-capabilities.json";

const LT_USERNAME = process.env.LT_USERNAME;
const LT_ACCESS_KEY = process.env.LT_ACCESS_KEY;
const BASE_URL =
	process.env.SMOKE_BASE_URL ??
	"https://jadujoel.github.io/web-audio-clip-node";

if (!LT_USERNAME || !LT_ACCESS_KEY) {
	console.error("Missing LT_USERNAME or LT_ACCESS_KEY environment variables");
	process.exit(1);
}

const LT_API_BASE = "https://api.lambdatest.com/automation/api/v1";

interface Target {
	name: string;
	browserName: string;
	browserVersion: string;
	platformName: string;
	deviceName?: string;
}

interface SmokeResult {
	target: string;
	passed: boolean;
	errors: string[];
	durationMs: number;
}

const filterName = process.argv[2];

const selectedTargets: Target[] = filterName
	? targets.targets.filter((t) => t.name === filterName)
	: targets.targets;

if (selectedTargets.length === 0) {
	console.error(
		`No target found matching "${filterName}". Available: ${targets.targets.map((t) => t.name).join(", ")}`,
	);
	process.exit(1);
}

const smokeChecks = [
	{
		name: "landing-page-loads",
		path: "/",
		titlePattern: /web-audio-clip-node/i,
		requiredElements: ["a[href]"],
	},
	{
		name: "streaming-page-loads",
		path: "/streaming",
		titlePattern: /stream/i,
		requiredElements: [
			"h1",
			"select#format-select",
			"input#url",
			"button",
			"section#display",
			".playhead-slider",
		],
	},
] as const;

async function runSmoke(target: Target): Promise<SmokeResult> {
	const start = Date.now();
	const errors: string[] = [];
	let sessionId: string | undefined;
	let browser: WebdriverIO.Browser | undefined;

	try {
		browser = await remote({
			automationProtocol: "webdriver" as const,
			capabilities: {
				browserName: target.browserName,
				browserVersion: target.browserVersion,
				"LT:Options": {
					platformName: target.platformName,
					...(target.deviceName ? { deviceName: target.deviceName } : {}),
					build: `smoke-${new Date().toISOString().slice(0, 10)}`,
					project: "web-audio-clip-node",
					name: `smoke-${target.name}`,
					w3c: true,
					network: true,
					video: true,
					visual: true,
				},
			},
			logLevel: "warn" as const,
			connectionRetryCount: 1,
			connectionRetryTimeout: 90_000,
			hostname: "hub.lambdatest.com",
			port: 443,
			protocol: "https" as const,
			path: "/wd/hub",
			user: LT_USERNAME,
			key: LT_ACCESS_KEY,
		});
		sessionId = browser.sessionId;
		const b = browser;

		for (const check of smokeChecks) {
			const url = `${BASE_URL}${check.path}`;
			console.log(`  [${target.name}] Navigating to ${url}`);
			await b.url(url);

			// Wait for page to be interactive
			await b.waitUntil(
				async () => {
					const state = await b.execute(() => document.readyState);
					return state === "complete";
				},
				{ timeout: 30_000, timeoutMsg: `Page did not load: ${url}` },
			);

			// Check title
			const title = await b.getTitle();
			if (!check.titlePattern.test(title)) {
				errors.push(
					`[${check.name}] Expected title matching ${check.titlePattern}, got "${title}"`,
				);
			}

			// Check required elements exist
			for (const selector of check.requiredElements) {
				const el = await b.$(selector);
				const exists = await el.isExisting();
				if (!exists) {
					errors.push(`[${check.name}] Missing element: ${selector}`);
				}
			}

			// Check for JS errors via console logs (LambdaTest captures these)
			try {
				const logs = await b.getLogs("browser");
				const severeErrors = (
					logs as { level: string; message: string }[]
				).filter(
					(log) => log.level === "SEVERE" && !log.message.includes("favicon"),
				);
				for (const log of severeErrors) {
					errors.push(`[${check.name}] JS error: ${log.message}`);
				}
			} catch {
				// Some browsers don't support log retrieval — not a failure
			}
		}

		return {
			target: target.name,
			passed: errors.length === 0,
			errors,
			durationMs: Date.now() - start,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errors.push(`Fatal: ${msg}`);
		return {
			target: target.name,
			passed: false,
			errors,
			durationMs: Date.now() - start,
		};
	} finally {
		if (browser) {
			await browser.deleteSession();
		}
		// Update test status on LambdaTest dashboard via REST API
		if (sessionId) {
			const passed = errors.length === 0;
			try {
				await fetch(`${LT_API_BASE}/sessions/${sessionId}`, {
					method: "PATCH",
					headers: {
						Authorization: `Basic ${btoa(`${LT_USERNAME}:${LT_ACCESS_KEY}`)}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						status_ind: passed ? "passed" : "failed",
					}),
				});
			} catch {
				// Non-critical: dashboard status is informational
			}
		}
	}
}

console.log(
	`Running smoke tests on ${selectedTargets.length} target(s) against ${BASE_URL}\n`,
);

const results: SmokeResult[] = [];

for (const target of selectedTargets) {
	console.log(
		`Starting: ${target.name} (${target.browserName} ${target.browserVersion} on ${target.platformName})`,
	);
	const result = await runSmoke(target);
	results.push(result);
	const icon = result.passed ? "✅" : "❌";
	console.log(
		`${icon} ${result.target} (${result.durationMs}ms)${result.errors.length > 0 ? `\n   ${result.errors.join("\n   ")}` : ""}\n`,
	);
}

console.log("\n--- Summary ---");
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${results.length}`);

if (failed > 0) {
	process.exit(1);
}
