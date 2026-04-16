import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{ browser: "chromium" }],
		},
		setupFiles: ["./vitest.setup.ts"],
		globalSetup: ["./vitest.global-setup.ts"],
		include: [
			"TestPreload.test.ts",
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"examples/**/*.test.ts",
		],
		exclude: [
			"**/node_modules/**",
			"build.test.ts",
			"test-runner-config.test.ts",
			"src/examplesConfig.test.ts",
			"src/streaming.test.ts",
		],
	},
	// Serve sound files and dist/ as static assets for browser tests
	publicDir: false,
	server: {
		fs: {
			allow: ["."],
		},
	},
});
