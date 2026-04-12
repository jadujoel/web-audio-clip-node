import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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

export async function examples() {
	await Bun.$`bun run build:lib`;
	await Promise.all([
		linkWorkspacePackage("examples/playground"),
		linkWorkspacePackage("examples/esm-bundler"),
	]);
	await Bun.$`bun examples/index.html examples/cdn-vanilla/index.html examples/cdn-opus-streaming/index.html examples/playground/index.html examples/esm-bundler/index.html examples/streaming/index.html`;
}

if (import.meta.main) {
	await examples();
}
