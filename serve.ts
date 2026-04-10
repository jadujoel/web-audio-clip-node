import index from "./src/index.html";

const processorBuild = await Bun.build({
	entrypoints: ["./src/audio/processor.ts"],
	target: "browser",
	minify: false,
});

if (!processorBuild.success) {
	console.error("Failed to build processor:", processorBuild.logs);
	process.exit(1);
}

export async function buildProcessor(): Promise<string> {
	await Bun.build({
		entrypoints: ["./src/audio/processor.ts"],
		target: "browser",
		minify: false,
		throw: false,
		sourcemap: "inline",
	});
	const processorCode = await processorBuild.outputs[0].text();
	if (!processorCode) {
		throw new Error("Failed to read processor code.");
	}
	return processorCode;
}

export function serve(): Bun.Server<unknown> {
	return Bun.serve({
		routes: {
			"/": index,
			"/index.html": index,
			"/processor.js": {
				async GET() {
					return new Response(await buildProcessor(), {
						headers: { "Content-Type": "application/javascript" },
					});
				},
			},
		},
	});
}

if (import.meta.main) {
	const server = serve()
  console.log("Server running at http://localhost:3000");
}
