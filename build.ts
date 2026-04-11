import { readdir, readFile, rm, writeFile } from "node:fs/promises";

export async function buildProcessor(minify = true): Promise<string> {
	const output = await Bun.build({
		entrypoints: ["./src/audio/processor.ts"],
		target: "browser",
		minify,
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

function withJsExtension(specifier: string): string {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
		return specifier;
	}

	if (/\.[a-z0-9]+(?:[?#].*)?$/i.test(specifier)) {
		return specifier;
	}

	return `${specifier}.js`;
}

export function addJsExtensionsToRelativeImports(source: string): string {
	return source
		.replace(
			/((?:import|export)\s[^"'`]*?from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
			(_match, prefix: string, specifier: string, suffix: string) =>
				`${prefix}${withJsExtension(specifier)}${suffix}`,
		)
		.replace(
			/(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
			(_match, prefix: string, specifier: string, suffix: string) =>
				`${prefix}${withJsExtension(specifier)}${suffix}`,
		);
}

async function rewriteDistImports(dir: string): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const entryPath = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			await rewriteDistImports(entryPath);
			continue;
		}

		if (!entry.isFile() || !entry.name.endsWith(".js")) {
			continue;
		}

		const source = await readFile(entryPath, "utf8");
		const updated = addJsExtensionsToRelativeImports(source);
		if (updated !== source) {
			await writeFile(entryPath, updated);
		}
	}
}

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
	// Copy static assets for GitHub Pages
	await Bun.write("dist/example.mp3", Bun.file("src/example.mp3"));
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

	await rewriteDistImports(distDir);

	// 5. Bundle single-file ESM for CDN usage (no bare specifiers)
	const esbuild = Bun.spawn(
		[
			"bunx",
			"esbuild",
			"src/lib.ts",
			"--bundle",
			"--format=esm",
			"--minify",
			"--sourcemap",
			"--outfile=dist/lib.bundle.js",
		],
		{ stdio: ["inherit", "inherit", "inherit"] },
	);
	const esbuildExit = await esbuild.exited;
	if (esbuildExit !== 0) {
		throw new Error(`esbuild exited with code ${esbuildExit}`);
	}

	// 6. Copy styles
	await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
	await Bun.write("dist/styles.css.d.ts", Bun.file("src/styles.css.d.ts"));
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
