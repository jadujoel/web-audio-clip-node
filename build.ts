import { rm } from "node:fs/promises";

export async function buildProcessor(): Promise<string> {
	const output = await Bun.build({
		entrypoints: ["./src/audio/processor.ts"],
		target: "browser",
		minify: true,
		throw: true,
		sourcemap: "linked",
		outdir: "dist",
	});
	const processorCode = await output.outputs[0].text();
	if (!processorCode) {
		throw new Error("Failed to read processor code.");
	}
	return processorCode;
}

const reactProductionDefine = {
	"process.env.NODE_ENV": '"production"',
};

const distDir = "dist";

export function createAppBuildConfig(outdir = distDir): Bun.BuildConfig {
	return {
		entrypoints: ["./src/index.html"],
		target: "browser",
		minify: true,
		throw: true,
		sourcemap: "linked",
		outdir,
		reactFastRefresh: false,
		define: reactProductionDefine,
	};
}

export async function build(): Promise<void> {
	await rm(distDir, { force: true, recursive: true });
	await buildProcessor();
	await Bun.build(createAppBuildConfig());
}

if (import.meta.main) {
	await build();
	console.log("Build completed.");
}
