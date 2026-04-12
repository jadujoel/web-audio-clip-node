const workers = [
	{
		entry: "./mp3-decode-worker.ts",
		output: "./generated/mp3-worker-code.ts",
		exportName: "mp3WorkerCode",
	},
	{
		entry: "./ogg-opus-decode-worker.ts",
		output: "./generated/ogg-opus-worker-code.ts",
		exportName: "oggOpusWorkerCode",
	},
	{
		entry: "./raw-opus-framed-decode-worker.ts",
		output: "./generated/raw-opus-framed-worker-code.ts",
		exportName: "rawOpusFramedWorkerCode",
	},
	{
		entry: "./webm-opus-decode-worker.ts",
		output: "./generated/webm-opus-worker-code.ts",
		exportName: "webmOpusWorkerCode",
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
