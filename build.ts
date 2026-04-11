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

export async function build(): Promise<void> {
  await buildProcessor();
  await Bun.build({
    entrypoints: ["./src/index.html"],
    target: "browser",
    minify: true,
    throw: true,
    sourcemap: "linked",
    outdir: "dist",
  });
}

if (import.meta.main) {
  await build();
  console.log("Build completed.");
}
