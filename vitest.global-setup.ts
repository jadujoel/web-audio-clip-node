/**
 * Global setup: runs once before all tests in Node.js context.
 * Builds the processor and workers so browser tests can load them.
 */
import { execSync } from "node:child_process";

export function setup() {
	console.log("[global-setup] Building processor and workers…");
	execSync("bun build.ts --lib", { stdio: "inherit" });
	console.log("[global-setup] Build complete.");
}
