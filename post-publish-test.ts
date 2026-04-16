/**
 * Post-publish smoke test.
 *
 * Packs the library into a tarball (or installs from the registry when
 * `--registry` is passed), then verifies every exported entry-point is
 * importable, key symbols exist, and TypeScript types compile cleanly.
 *
 * Usage:
 *   bun post-publish-test.ts            # test the local tarball (npm pack)
 *   bun post-publish-test.ts --registry # test from the npm registry
 */

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const useRegistry = process.argv.includes("--registry");
const root = import.meta.dir;
const errors: string[] = [];

// Shim browser globals so ClipNode (extends AudioWorkletNode) and
// data modules (CacheStorage, IndexedDB) can load outside a browser.
const g = globalThis as Record<string, unknown>;
if (typeof globalThis.AudioWorkletNode === "undefined") {
	g.AudioWorkletNode = class AudioWorkletNode {};
}
if (typeof globalThis.AudioBuffer === "undefined") {
	g.AudioBuffer = class AudioBuffer {};
}
if (typeof globalThis.caches === "undefined") {
	g.caches = { open: () => Promise.resolve({}) };
}
if (typeof globalThis.indexedDB === "undefined") {
	g.indexedDB = { open: () => ({}) };
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		errors.push(message);
		console.error(`  FAIL: ${message}`);
	} else {
		console.log(`  PASS: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// 1. Create an isolated temp project
// ---------------------------------------------------------------------------
const tmp = await mkdtemp(join(tmpdir(), "clip-publish-test-"));
console.log(`Temp directory: ${tmp}`);

async function cleanup() {
	await rm(tmp, { force: true, recursive: true });
}

try {
	// Determine the install specifier: local tarball or registry
	let installSpec: string;

	if (useRegistry) {
		const pkg = await Bun.file(join(root, "package.json")).json();
		installSpec = `${pkg.name}@${pkg.version}`;
		console.log(`\nInstalling from registry: ${installSpec}`);
	} else {
		// npm pack produces a tarball
		console.log("\nPacking tarball…");
		const pack = Bun.spawn(["npm", "pack", "--pack-destination", tmp], {
			cwd: root,
			stdio: ["inherit", "pipe", "inherit"],
		});
		const packOutput = await new Response(pack.stdout).text();
		const packExit = await pack.exited;
		if (packExit !== 0) throw new Error("npm pack failed");
		const lines = packOutput.trim().split("\n");
		const tarball = lines[lines.length - 1];
		installSpec = join(tmp, tarball);
		console.log(`Packed: ${installSpec}`);
	}

	// Write a minimal package.json + tsconfig for the temp project
	await writeFile(
		join(tmp, "package.json"),
		JSON.stringify(
			{
				name: "post-publish-test",
				private: true,
				type: "module",
				dependencies: {},
			},
			null,
			2,
		),
	);

	await writeFile(
		join(tmp, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					module: "Node16",
					moduleResolution: "Node16",
					strict: true,
					skipLibCheck: true,
					noEmit: true,
					types: [],
				},
				include: ["*.ts"],
			},
			null,
			2,
		),
	);

	// Install
	console.log("\nInstalling package…");
	const install = Bun.spawn(["npm", "install", installSpec], {
		cwd: tmp,
		stdio: ["inherit", "inherit", "inherit"],
	});
	const installExit = await install.exited;
	if (installExit !== 0) throw new Error("npm install failed");

	// -----------------------------------------------------------------------
	// 2. Verify the main entry (".")
	// -----------------------------------------------------------------------
	console.log("\n--- Main entry (.) ---");
	const main = await import(
		join(tmp, "node_modules/@jadujoel/web-audio-clip-node/dist/lib.js")
	);

	assert(typeof main.ClipNode === "function", "ClipNode is exported");
	assert(typeof main.Coordinator === "function", "Coordinator is exported");
	assert(
		typeof main.StreamingClipNode === "function",
		"StreamingClipNode is exported",
	);
	assert(typeof main.processorCode === "string", "processorCode is a string");
	assert(main.processorCode.length > 0, "processorCode is non-empty");
	assert(typeof main.processBlock === "function", "processBlock is exported");
	assert(typeof main.getProperties === "function", "getProperties is exported");
	assert(
		typeof main.createFilterState === "function",
		"createFilterState is exported",
	);
	assert(
		typeof main.handleProcessorMessage === "function",
		"handleProcessorMessage is exported",
	);
	assert(
		typeof main.SAMPLE_BLOCK_SIZE === "number",
		"SAMPLE_BLOCK_SIZE is a number",
	);
	assert(typeof main.State === "object", "State enum is exported");
	assert(
		typeof main.audioBufferFromFloat32Array === "function",
		"audioBufferFromFloat32Array is exported",
	);
	assert(typeof main.dbFromLin === "function", "dbFromLin is exported");
	assert(typeof main.linFromDb === "function", "linFromDb is exported");
	assert(
		typeof main.float32ArrayFromAudioBuffer === "function",
		"float32ArrayFromAudioBuffer is exported",
	);
	assert(typeof main.presets === "object", "presets is exported");
	assert(
		typeof main.generateSnapPoints === "function",
		"generateSnapPoints is exported",
	);
	assert(
		typeof main.getSnappedValue === "function",
		"getSnappedValue is exported",
	);
	assert(
		typeof main.getTempoSnapInterval === "function",
		"getTempoSnapInterval is exported",
	);
	assert(
		typeof main.isTempoRelativeSnap === "function",
		"isTempoRelativeSnap is exported",
	);
	assert(
		typeof main.remapTempoRelativeValue === "function",
		"remapTempoRelativeValue is exported",
	);
	assert(
		typeof main.getProcessorBlobUrl === "function",
		"getProcessorBlobUrl is exported",
	);
	assert(
		typeof main.getProcessorCdnUrl === "function",
		"getProcessorCdnUrl is exported",
	);
	assert(
		typeof main.getProcessorModuleUrl === "function",
		"getProcessorModuleUrl is exported",
	);
	assert(typeof main.controlDefs === "object", "controlDefs is exported");
	assert(typeof main.allDefs === "object", "allDefs is exported");
	assert(typeof main.buildDefaults === "function", "buildDefaults is exported");
	assert(typeof main.paramDefs === "object", "paramDefs is exported");
	assert(
		typeof main.loopControlDefs === "object",
		"loopControlDefs is exported",
	);
	assert(typeof main.DEFAULT_TEMPO === "number", "DEFAULT_TEMPO is exported");
	assert(typeof main.SAMPLE_RATE === "number", "SAMPLE_RATE is exported");
	assert(
		typeof main.formatValueText === "function",
		"formatValueText is exported",
	);
	assert(
		typeof main.formatTickLabel === "function",
		"formatTickLabel is exported",
	);
	assert(
		typeof main.buildLinkedControlPairDefaults === "function",
		"buildLinkedControlPairDefaults is exported",
	);
	assert(
		typeof main.getActiveLinkedControls === "function",
		"getActiveLinkedControls is exported",
	);
	assert(
		typeof main.getLinkedControlPairForControl === "function",
		"getLinkedControlPairForControl is exported",
	);
	assert(
		typeof main.getLinkedControlUpdates === "function",
		"getLinkedControlUpdates is exported",
	);
	assert(
		typeof main.loopLinkedControlPairs === "object",
		"loopLinkedControlPairs is exported",
	);
	assert(
		typeof main.transportLinkedControlPairs === "object",
		"transportLinkedControlPairs is exported",
	);
	assert(typeof main.loadFromCache === "function", "loadFromCache is exported");
	assert(
		typeof main.loadUploadedFile === "function",
		"loadUploadedFile is exported",
	);
	assert(
		typeof main.saveUploadedFile === "function",
		"saveUploadedFile is exported",
	);

	// -----------------------------------------------------------------------
	// 3. Verify the React entry ("./react")
	// -----------------------------------------------------------------------
	console.log("\n--- React entry (./react) ---");
	// React components need React as peer dep — just verify the module is readable
	const reactPath = join(
		tmp,
		"node_modules/@jadujoel/web-audio-clip-node/dist/lib-react.js",
	);
	const reactSource = await Bun.file(reactPath).text();
	assert(reactSource.length > 0, "lib-react.js is non-empty");

	const reactExportNames = [
		"AudioControl",
		"ContextMenu",
		"ControlSection",
		"DetuneControl",
		"DisplayPanel",
		"FilterControl",
		"GainControl",
		"PanControl",
		"PlaybackRateControl",
		"PlayheadSlider",
		"SnappableSlider",
		"TransportButtons",
		"useClipNode",
		"useClipControls",
	];
	for (const name of reactExportNames) {
		assert(reactSource.includes(name), `react entry references ${name}`);
	}

	// -----------------------------------------------------------------------
	// 4. Verify the processor entry ("./processor")
	// -----------------------------------------------------------------------
	console.log("\n--- Processor entry (./processor) ---");
	const processorPath = join(
		tmp,
		"node_modules/@jadujoel/web-audio-clip-node/dist/clip-processor.bundle.js",
	);
	const processorSource = await Bun.file(processorPath).text();
	assert(processorSource.length > 0, "clip-processor.bundle.js is non-empty");
	assert(
		processorSource.includes("registerProcessor"),
		"clip-processor.bundle.js calls registerProcessor",
	);

	// -----------------------------------------------------------------------
	// 5. Verify the CSS entry ("./styles.css")
	// -----------------------------------------------------------------------
	console.log("\n--- Styles entry (./styles.css) ---");
	const cssPath = join(
		tmp,
		"node_modules/@jadujoel/web-audio-clip-node/dist/styles.css",
	);
	const cssSource = await Bun.file(cssPath).text();
	assert(cssSource.length > 0, "styles.css is non-empty");

	// -----------------------------------------------------------------------
	// 6. Verify .d.ts type declarations exist
	// -----------------------------------------------------------------------
	console.log("\n--- Type declarations ---");
	const distDir = join(tmp, "node_modules/@jadujoel/web-audio-clip-node/dist");
	const distFiles = await readdir(distDir, { recursive: true });
	const dtsFiles = distFiles.filter((f) => f.endsWith(".d.ts"));
	assert(dtsFiles.length > 0, `Found ${dtsFiles.length} .d.ts files`);
	assert(
		dtsFiles.some((f) => f === "lib.d.ts"),
		"lib.d.ts exists",
	);
	assert(
		dtsFiles.some((f) => f === "lib-react.d.ts"),
		"lib-react.d.ts exists",
	);
	assert(
		dtsFiles.some((f) => f === "styles.css.d.ts"),
		"styles.css.d.ts exists",
	);

	// -----------------------------------------------------------------------
	// 7. Verify TypeScript compilation against the package types
	// -----------------------------------------------------------------------
	console.log("\n--- TypeScript type checking ---");
	await writeFile(
		join(tmp, "check-types.ts"),
		`
import "@jadujoel/web-audio-clip-node/styles.css";

import type { ClipNode, ClipNodeState, ClipProcessorState, FrameData } from "@jadujoel/web-audio-clip-node";
import type { ControlDef, ControlKey } from "@jadujoel/web-audio-clip-node";
import type { LinkedControlPairDef, LinkedControlPairKey } from "@jadujoel/web-audio-clip-node";
import type { SliderPreset, TempoRelativeSnap } from "@jadujoel/web-audio-clip-node";
import type { BufferRangeWrite, StreamBufferSpan, StreamBufferState } from "@jadujoel/web-audio-clip-node";
import type { ClipWorkletOptions, ClipProcessorOptions, ClipProcessorToggleMessageType } from "@jadujoel/web-audio-clip-node";
import type { StoredFile } from "@jadujoel/web-audio-clip-node";

import {
  processorCode,
  processBlock,
  getProperties,
  createFilterState,
  handleProcessorMessage,
  SAMPLE_BLOCK_SIZE,
  State,
  audioBufferFromFloat32Array,
  dbFromLin,
  linFromDb,
  float32ArrayFromAudioBuffer,
  presets,
  generateSnapPoints,
  getSnappedValue,
  getTempoSnapInterval,
  isTempoRelativeSnap,
  remapTempoRelativeValue,
  getProcessorBlobUrl,
  getProcessorCdnUrl,
  getProcessorModuleUrl,
  controlDefs,
  allDefs,
  buildDefaults,
  paramDefs,
  loopControlDefs,
  DEFAULT_TEMPO,
  SAMPLE_RATE,
  formatValueText,
  formatTickLabel,
  buildLinkedControlPairDefaults,
  getActiveLinkedControls,
  getLinkedControlPairForControl,
  getLinkedControlUpdates,
  loopLinkedControlPairs,
  transportLinkedControlPairs,
  loadFromCache,
  loadUploadedFile,
  saveUploadedFile,
} from "@jadujoel/web-audio-clip-node";

// Verify function signatures
const _cdnUrl: string = getProcessorCdnUrl();
const _snapPoints: { value: number; label: string }[] = generateSnapPoints(120, "1/4");
const _db: number = dbFromLin(0.5);
const _lin: number = linFromDb(-6);
const _defs: Record<string, ControlDef> = controlDefs;
const _defaults = buildDefaults();

// Verify types are usable
type _CheckState = ClipNodeState;
type _CheckFrame = FrameData;
type _CheckControlKey = ControlKey;
type _CheckPairKey = LinkedControlPairKey;
type _CheckPreset = SliderPreset;
type _CheckSnap = TempoRelativeSnap;
type _CheckBuf = BufferRangeWrite;
type _CheckStoredFile = StoredFile;

console.log("Types OK");
`,
	);

	const tscPath = join(tmp, "node_modules/.bin/tsc");
	// Install typescript in the temp dir
	const installTs = Bun.spawn(["npm", "install", "typescript@latest"], {
		cwd: tmp,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if ((await installTs.exited) !== 0)
		throw new Error("Failed to install typescript");

	const tsc = Bun.spawn([tscPath, "--noEmit"], {
		cwd: tmp,
		stdio: ["inherit", "pipe", "pipe"],
	});
	const tscStdout = await new Response(tsc.stdout).text();
	const tscStderr = await new Response(tsc.stderr).text();
	const tscExit = await tsc.exited;
	if (tscStdout) console.log(tscStdout);
	if (tscStderr) console.error(tscStderr);
	assert(tscExit === 0, "TypeScript type-check passes");

	// -----------------------------------------------------------------------
	// 8. Verify runtime behavior of pure functions
	// -----------------------------------------------------------------------
	console.log("\n--- Runtime behavior ---");
	assert(main.dbFromLin(1) === 0, "dbFromLin(1) === 0");
	assert(main.linFromDb(0) === 1, "linFromDb(0) === 1");
	assert(
		Math.abs(main.linFromDb(main.dbFromLin(0.5)) - 0.5) < 1e-6,
		"dbFromLin/linFromDb round-trip",
	);
	assert(main.DEFAULT_TEMPO > 0, "DEFAULT_TEMPO is positive");
	assert(main.SAMPLE_RATE > 0, "SAMPLE_RATE is positive");
	assert(
		typeof main.buildDefaults() === "object",
		"buildDefaults() returns an object",
	);
	assert(
		typeof main.buildLinkedControlPairDefaults() === "object",
		"buildLinkedControlPairDefaults() returns an object",
	);
	assert(
		typeof main.formatValueText(0, "gain", "none", 120) === "string",
		"formatValueText returns a string",
	);

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------
	console.log("\n========================================");
	if (errors.length > 0) {
		console.error(`\n${errors.length} FAILURE(S):`);
		for (const e of errors) console.error(`  - ${e}`);
		process.exit(1);
	} else {
		console.log("\nAll post-publish checks passed!");
	}
} finally {
	await cleanup();
}
