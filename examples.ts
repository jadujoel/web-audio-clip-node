import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

async function linkWorkspacePackage(exampleDir: string) {
	const nodeModulesDir = join(exampleDir, "node_modules");
	const scopeDir = join(nodeModulesDir, "@jadujoel");

	await rm(nodeModulesDir, { force: true, recursive: true });
	await mkdir(scopeDir, { recursive: true });
	await symlink(process.cwd(), join(scopeDir, "web-audio-clip-node"), "dir");
}

export async function examples() {
	await Bun.$`bun run build:lib`;
	await Promise.all([
		linkWorkspacePackage("examples/react"),
		linkWorkspacePackage("examples/esm-bundler"),
		linkWorkspacePackage("examples/self-hosted"),
		linkWorkspacePackage("examples/streaming"),
	]);
	await Bun.$`bun run --cwd examples/self-hosted setup`;
	await Bun.$`bun examples/index.html examples/cdn-vanilla/index.html examples/esm-bundler/index.html examples/react/index.html examples/self-hosted/index.html examples/streaming/index.html`;
}

if (import.meta.main) {
	await examples();
}
