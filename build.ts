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

async function buildProcessorCodeModule(): Promise<string> {
	const code = await buildProcessor();
	await Bun.write(
		"src/audio/processor-code.ts",
		`// AUTO-GENERATED — do not edit. Run 'bun run build:lib' to regenerate.\nexport const processorCode =\n\t${JSON.stringify(code)};\n`,
	);
	return code;
}

export async function buildLibrary(): Promise<void> {
	await rm(distDir, { force: true, recursive: true });

	// 1. Compile processor and generate embedded code module
	const processorSource = await buildProcessorCodeModule();

	// 2. Write standalone processor.js for CDN usage
	await Bun.write("dist/processor.js", processorSource);

	// 3. Generate version module from package.json
	const { version } = await Bun.file("package.json").json();
	await Bun.write(
		"src/audio/version.ts",
		`// AUTO-GENERATED — do not edit. Run 'bun run build:lib' to regenerate.\nexport const VERSION = ${JSON.stringify(version)};\n`,
	);

	// 4. Emit JS + .d.ts via tsc
	const tsc = Bun.spawn(["bunx", "tsc", "--project", "tsconfig.build.json"], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	const exitCode = await tsc.exited;
	if (exitCode !== 0) {
		throw new Error(`tsc exited with code ${exitCode}`);
	}

	// 5. Copy styles
	await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
}

if (import.meta.main) {
	if (process.argv.includes("--lib")) {
		await buildLibrary();
		console.log("Library build completed.");
	} else {
		await build();
		console.log("Build completed.");
	}
}
