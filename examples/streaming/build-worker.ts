const workers = [
	{
		entry: "../../src/workers/aac-adts-decode-worker.ts",
		output: "./generated/aac-adts-worker-code.ts",
		exportName: "aacAdtsWorkerCode",
	},
	{
		entry: "../../src/workers/flac-decode-worker.ts",
		output: "./generated/flac-worker-code.ts",
		exportName: "flacWorkerCode",
	},
	{
		entry: "../../src/workers/mp3-decode-worker.ts",
		output: "./generated/mp3-worker-code.ts",
		exportName: "mp3WorkerCode",
	},
	{
		entry: "../../src/workers/mp4-aac-decode-worker.ts",
		output: "./generated/mp4-aac-worker-code.ts",
		exportName: "mp4AacWorkerCode",
	},
	{
		entry: "../../src/workers/ogg-flac-decode-worker.ts",
		output: "./generated/ogg-flac-worker-code.ts",
		exportName: "oggFlacWorkerCode",
	},
	{
		entry: "../../src/workers/ogg-opus-decode-worker.ts",
		output: "./generated/ogg-opus-worker-code.ts",
		exportName: "oggOpusWorkerCode",
	},
	{
		entry: "../../src/workers/ogg-vorbis-decode-worker.ts",
		output: "./generated/ogg-vorbis-worker-code.ts",
		exportName: "oggVorbisWorkerCode",
	},
	{
		entry: "../../src/workers/raw-opus-framed-decode-worker.ts",
		output: "./generated/raw-opus-framed-worker-code.ts",
		exportName: "rawOpusFramedWorkerCode",
	},
	{
		entry: "../../src/workers/webm-opus-decode-worker.ts",
		output: "./generated/webm-opus-worker-code.ts",
		exportName: "webmOpusWorkerCode",
	},
	{
		entry: "../../src/workers/webm-vorbis-decode-worker.ts",
		output: "./generated/webm-vorbis-worker-code.ts",
		exportName: "webmVorbisWorkerCode",
	},
] as const;

for (const worker of workers) {
	const result = await Bun.build({
		entrypoints: [worker.entry],
		target: "browser",
		minify: true,
	});

	if (!result.success) {
		console.error(`Worker build failed for ${worker.entry}:`, result.logs);
		process.exit(1);
	}

	const code = await result.outputs[0].text();
	const escaped = JSON.stringify(code);

	await Bun.write(
		worker.output,
		`// AUTO-GENERATED — do not edit. Run \`bun run build:worker\` to regenerate.\nexport const ${worker.exportName} = ${escaped};\n`,
	);

	console.log(
		`Built ${worker.entry} (${code.length} bytes) → ${worker.output}`,
	);
}

export {};
