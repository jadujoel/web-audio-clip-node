export async function examples() {
  await Promise.all([
    Bun.$`bun install --cwd examples/esm-bundler`,
    Bun.$`bun install --cwd examples/react`,
    Bun.$`bun install --cwd examples/self-hosted`,
  ]);
	await Bun.$`bun examples/index.html examples/cdn-vanilla/index.html examples/esm-bundler/index.html examples/react/index.html examples/self-hosted/index.html`;
}

if (import.meta.main) {
  await examples()
}
