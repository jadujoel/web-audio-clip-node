import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, parse as parsePath } from "node:path";

export async function latestCdnVersion(): Promise<string> {
	return (
		await Bun.$`bun info @jadujoel/web-audio-clip-node version`.text()
	).trim();
}

/**
 * Write a file and also emit a hash-suffixed copy next to it.
 * E.g. `foo.min.js` → `foo.min.a1b2c3d4.js`
 */
async function writeWithHash(filePath: string, content: string): Promise<void> {
	await Bun.write(filePath, content);
	const hash = new Bun.CryptoHasher("sha256")
		.update(content)
		.digest("hex")
		.slice(0, 8);
	const { dir, name, ext } = parsePath(filePath);
	await Bun.write(join(dir, `${name}.${hash}${ext}`), content);
}

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
const webpageDir = "webpage";

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
		entrypoints: ["./examples/playground/index.html"],
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
	await buildLibrary();
	await buildWebpage();
}

async function linkWorkspacePackage(exampleDir: string) {
	const nodeModulesDir = join(exampleDir, "node_modules");
	const packageDir = join(nodeModulesDir, "@jadujoel", "web-audio-clip-node");

	await rm(packageDir, { force: true, recursive: true });
	await mkdir(packageDir, { recursive: true });
	await cp(join(process.cwd(), "dist"), join(packageDir, "dist"), {
		recursive: true,
	});
	await cp(
		join(process.cwd(), "package.json"),
		join(packageDir, "package.json"),
	);
	await cp(join(process.cwd(), "README.md"), join(packageDir, "README.md"));
	await cp(join(process.cwd(), "LICENSE"), join(packageDir, "LICENSE"));
}

async function copySounds(outputRoot: string): Promise<void> {
	const soundsDir = "src/sounds";
	const outDir = join(outputRoot, "sounds");
	await mkdir(outDir, { recursive: true });
	for (const entry of await readdir(soundsDir)) {
		await cp(join(soundsDir, entry), join(outDir, entry));
	}
}

async function copyPolyfillAssets(outputRoot: string): Promise<void> {
	const outDir = join(outputRoot, "polyfill");
	await mkdir(outDir, { recursive: true });

	// Copy libavjs-webcodecs-polyfill loader
	const polyfillSrc =
		"node_modules/libavjs-webcodecs-polyfill/dist/libavjs-webcodecs-polyfill.js";
	if (existsSync(polyfillSrc)) {
		await cp(polyfillSrc, join(outDir, "libavjs-webcodecs-polyfill.js"));
	}

	// Copy libav.js webcodecs variant (supports Opus, Vorbis, FLAC)
	const libavDir = "node_modules/libav.js/dist";
	if (existsSync(libavDir)) {
		const entries = await readdir(libavDir);
		for (const entry of entries) {
			if (
				entry.includes("-webcodecs.") &&
				!entry.includes("-avf.") &&
				!entry.includes("-cli.") &&
				!entry.includes("-thr.") &&
				!entry.includes(".mjs")
			) {
				await cp(join(libavDir, entry), join(outDir, entry));
			}
		}
	}
}

export async function buildWebpage(): Promise<void> {
	await rm(webpageDir, { force: true, recursive: true });

	const hasReactExample = existsSync("examples/react/index.html");
	const hasSelfHostedExample = existsSync("examples/self-hosted/index.html");
	const hasSelfHostedSetup = existsSync("examples/self-hosted/package.json");
	const hasSelfHostedProcessor = existsSync(
		"examples/self-hosted/public/processor.js",
	);

	// Link library to examples that use package imports
	const linkTasks: Promise<void>[] = [
		linkWorkspacePackage("examples/playground"),
		linkWorkspacePackage("examples/esm-bundler"),
		linkWorkspacePackage("examples/coordinator-streaming"),
	];
	if (hasReactExample) {
		linkTasks.push(linkWorkspacePackage("examples/react"));
	}
	if (hasSelfHostedExample) {
		linkTasks.push(linkWorkspacePackage("examples/self-hosted"));
	}
	await Promise.all(linkTasks);

	// Self-hosted needs processor.js copied
	if (hasSelfHostedExample && hasSelfHostedSetup) {
		await Bun.$`bun run --cwd examples/self-hosted setup`;
	}

	// Streaming worker build
	await Bun.$`bun run --cwd examples/streaming build:worker`;

	// Read version for CDN example pinning
	const { version } = await Bun.file("package.json").json();

	// Copy a CDN example dir, replacing @latest with the pinned version
	async function copyCdnExample(name: string): Promise<void> {
		const src = join("examples", name);
		const dest = join(webpageDir, name);
		await mkdir(dest, { recursive: true });
		for (const entry of await readdir(src)) {
			const srcPath = join(src, entry);
			const destPath = join(dest, entry);
			if (entry.endsWith(".html")) {
				const html = await readFile(srcPath, "utf8");
				await writeFile(destPath, html.replaceAll("@latest", `@${version}`));
			} else {
				await cp(srcPath, destPath, { recursive: true });
			}
		}
	}

	// Build all examples in parallel
	const buildTasks: Promise<unknown>[] = [
		// Landing page
		Bun.build({
			entrypoints: ["./examples/index.html"],
			outdir: webpageDir,
			target: "browser",
			minify: true,
			throw: true,
		}),
		// CDN Vanilla — version-pinned copy
		copyCdnExample("cdn-vanilla"),
		// CDN Opus Streaming — version-pinned copy
		copyCdnExample("cdn-opus-streaming"),
		// Playground — full interactive demo
		Bun.build({
			entrypoints: ["./examples/playground/index.html"],
			outdir: join(webpageDir, "playground"),
			target: "browser",
			minify: true,
			throw: true,
			define: reactProductionDefine,
		}),
		// ESM Bundler
		Bun.build({
			entrypoints: ["./examples/esm-bundler/index.html"],
			outdir: join(webpageDir, "esm-bundler"),
			target: "browser",
			minify: true,
			throw: true,
		}),
		// Coordinator Streaming (local build test)
		Bun.build({
			entrypoints: ["./examples/coordinator-streaming/index.html"],
			outdir: join(webpageDir, "coordinator-streaming"),
			target: "browser",
			minify: true,
			throw: true,
		}),
		// Streaming
		Bun.build({
			entrypoints: ["./examples/streaming/index.html"],
			outdir: join(webpageDir, "streaming"),
			target: "browser",
			minify: true,
			throw: true,
			define: reactProductionDefine,
		}),
	];

	if (hasReactExample) {
		buildTasks.push(
			Bun.build({
				entrypoints: ["./examples/react/index.html"],
				outdir: join(webpageDir, "react"),
				target: "browser",
				minify: true,
				throw: true,
				define: reactProductionDefine,
			}),
		);
	}

	if (hasSelfHostedExample) {
		buildTasks.push(
			Bun.build({
				entrypoints: ["./examples/self-hosted/index.html"],
				outdir: join(webpageDir, "self-hosted"),
				target: "browser",
				minify: true,
				throw: true,
			}),
		);
	}

	await Promise.all(buildTasks);

	// Copy self-hosted processor.js into its webpage output
	if (hasSelfHostedExample && hasSelfHostedProcessor) {
		await cp(
			"examples/self-hosted/public/processor.js",
			join(webpageDir, "self-hosted", "processor.js"),
		);
	}

	// Build streaming decode workers into webpage outputs that load workers via import.meta.url.
	const streamingWorkersDirs = [
		join(webpageDir, "streaming", "workers"),
		join(webpageDir, "coordinator-streaming", "workers"),
	];
	for (const dir of streamingWorkersDirs) {
		await mkdir(dir, { recursive: true });
	}
	for (const worker of streamingWorkerEntrypoints) {
		const result = await Bun.build({
			entrypoints: [worker.entry],
			target: "browser",
			minify: true,
			format: "iife",
		});
		if (!result.success) {
			throw new Error(
				`Worker build failed for ${worker.entry}: ${result.logs.join("\n")}`,
			);
		}
		const code = await result.outputs[0].text();
		for (const dir of streamingWorkersDirs) {
			await Bun.write(join(dir, worker.output), code);
		}
	}

	// Copy sound assets
	await copySounds(webpageDir);

	// Copy polyfill assets for AudioDecoder fallback
	await copyPolyfillAssets(webpageDir);

	// Copy favicon
	await cp("src/favicon.svg", join(webpageDir, "favicon.svg"));
}

async function buildProcessorCodeModule(): Promise<string> {
	const code = await buildProcessor();
	await Bun.write(
		"src/audio/processor-code.ts",
		`// AUTO-GENERATED — do not edit. Run 'bun run build:lib' to regenerate.\nexport const processorCode =\n\t${JSON.stringify(code)};\n`,
	);
	return code;
}

/** Map from StreamFormat to build entry, output code module path, and export name. */
const workerCodeModules = [
	{
		entry: "./src/workers/aac-adts-decode-worker.ts",
		file: "src/workers/aac-worker-code.ts",
		exportName: "aacWorkerCode",
	},
	{
		entry: "./src/workers/flac-decode-worker.ts",
		file: "src/workers/flac-worker-code.ts",
		exportName: "flacWorkerCode",
	},
	{
		entry: "./src/workers/mp3-decode-worker.ts",
		file: "src/workers/mp3-worker-code.ts",
		exportName: "mp3WorkerCode",
	},
	{
		entry: "./src/workers/mp4-aac-decode-worker.ts",
		file: "src/workers/mp4-aac-worker-code.ts",
		exportName: "mp4AacWorkerCode",
	},
	{
		entry: "./src/workers/ogg-flac-decode-worker.ts",
		file: "src/workers/ogg-flac-worker-code.ts",
		exportName: "oggFlacWorkerCode",
	},
	{
		entry: "./src/workers/ogg-opus-decode-worker.ts",
		file: "src/workers/ogg-opus-worker-code.ts",
		exportName: "oggOpusWorkerCode",
	},
	{
		entry: "./src/workers/ogg-vorbis-decode-worker.ts",
		file: "src/workers/ogg-vorbis-worker-code.ts",
		exportName: "oggVorbisWorkerCode",
	},
	{
		entry: "./src/workers/raw-opus-framed-decode-worker.ts",
		file: "src/workers/raw-opus-framed-worker-code.ts",
		exportName: "rawOpusFramedWorkerCode",
	},
	{
		entry: "./src/workers/webm-opus-decode-worker.ts",
		file: "src/workers/webm-opus-worker-code.ts",
		exportName: "webmOpusWorkerCode",
	},
	{
		entry: "./src/workers/webm-vorbis-decode-worker.ts",
		file: "src/workers/webm-vorbis-worker-code.ts",
		exportName: "webmVorbisWorkerCode",
	},
] as const;

async function buildWorkerCodeModules(): Promise<void> {
	for (const mod of workerCodeModules) {
		const result = await Bun.build({
			entrypoints: [mod.entry],
			target: "browser",
			minify: true,
			format: "iife",
		});
		if (!result.success) {
			throw new Error(
				`Worker build failed for ${mod.entry}: ${result.logs.join("\n")}`,
			);
		}
		const code = await result.outputs[0].text();
		await Bun.write(
			mod.file,
			`// AUTO-GENERATED — do not edit. Run 'bun run build:lib' to regenerate.\nexport const ${mod.exportName} =\n\t${JSON.stringify(code)};\n`,
		);
	}
}

export async function buildLibrary(): Promise<void> {
	await rm(distDir, { force: true, recursive: true });

	// 1. Compile processor and generate embedded code module
	const processorSource = await buildProcessorCodeModule();

	// 1b. Compile all streaming workers and generate embedded code modules
	await buildWorkerCodeModules();

	// 2. Write standalone processor.js for CDN usage (with hashed variant)
	await writeWithHash("dist/processor.js", processorSource);

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

	// Emit hashed variant of the CDN bundle
	const bundleContent = await Bun.file("dist/lib.bundle.js").text();
	const bundleHash = new Bun.CryptoHasher("sha256")
		.update(bundleContent)
		.digest("hex")
		.slice(0, 8);
	await Bun.write(`dist/lib.bundle.${bundleHash}.js`, bundleContent);

	// 6. Copy styles
	await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
	await Bun.write("dist/styles.css.d.ts", Bun.file("src/styles.css.d.ts"));

	// 7. Bundle streaming decode workers
	await buildStreamingWorkers();
}

const streamingWorkerEntrypoints = [
	{
		entry: "./src/workers/aac-adts-decode-worker.ts",
		output: "aac-adts-decode-worker.min.js",
	},
	{
		entry: "./src/workers/flac-decode-worker.ts",
		output: "flac-decode-worker.min.js",
	},
	{
		entry: "./src/workers/mp3-decode-worker.ts",
		output: "mp3-decode-worker.min.js",
	},
	{
		entry: "./src/workers/mp4-aac-decode-worker.ts",
		output: "mp4-aac-decode-worker.min.js",
	},
	{
		entry: "./src/workers/ogg-flac-decode-worker.ts",
		output: "ogg-flac-decode-worker.min.js",
	},
	{
		entry: "./src/workers/ogg-opus-decode-worker.ts",
		output: "ogg-opus-decode-worker.min.js",
	},
	{
		entry: "./src/workers/ogg-vorbis-decode-worker.ts",
		output: "ogg-vorbis-decode-worker.min.js",
	},
	{
		entry: "./src/workers/raw-opus-framed-decode-worker.ts",
		output: "raw-opus-framed-decode-worker.min.js",
	},
	{
		entry: "./src/workers/webm-opus-decode-worker.ts",
		output: "webm-opus-decode-worker.min.js",
	},
	{
		entry: "./src/workers/webm-vorbis-decode-worker.ts",
		output: "webm-vorbis-decode-worker.min.js",
	},
] as const;

async function buildStreamingWorkers(): Promise<void> {
	await mkdir("dist/workers", { recursive: true });
	for (const worker of streamingWorkerEntrypoints) {
		const result = await Bun.build({
			entrypoints: [worker.entry],
			target: "browser",
			minify: true,
			format: "iife",
		});
		if (!result.success) {
			throw new Error(
				`Worker build failed for ${worker.entry}: ${result.logs.join("\n")}`,
			);
		}
		const code = await result.outputs[0].text();
		await writeWithHash(join("dist/workers", worker.output), code);
	}
}

if (import.meta.main) {
	if (process.argv.includes("--lib")) {
		await buildLibrary();
		console.log("Library build completed.");
	} else if (process.argv.includes("--webpage")) {
		await buildWebpage();
		console.log("Webpage build completed.");
	} else {
		await build();
		console.log("Build completed.");
	}
}
