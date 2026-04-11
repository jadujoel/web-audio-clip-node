// Build decode-worker.ts → generated/worker-code.ts (as an exported string constant)
const result = await Bun.build({
	entrypoints: ["./decode-worker.ts"],
	target: "browser",
	minify: true,
});

if (!result.success) {
	console.error("Worker build failed:", result.logs);
	process.exit(1);
}

const code = await result.outputs[0].text();
const escaped = JSON.stringify(code);

await Bun.write(
	"./generated/worker-code.ts",
	`// AUTO-GENERATED — do not edit. Run \`bun run build:worker\` to regenerate.\nexport const workerCode = ${escaped};\n`,
);

console.log(`Built worker code (${code.length} bytes) → generated/worker-code.ts`);
