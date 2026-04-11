# Examples

Each subdirectory demonstrates a different integration path for `@jadujoel/web-audio-clip-node`.

From the repository root, run every example with:

```sh
bun run examples
```

That command builds the local package, links the examples that need it, and serves the demo entry points.

| Example | Description | Build step? |
|---------|-------------|-------------|
| [cdn-vanilla](./cdn-vanilla/) | Single HTML file using the jsDelivr bundle and a generated demo clip | No |
| [esm-bundler](./esm-bundler/) | Vite + TypeScript importing the package directly | Yes |
| [react](./react/) | Vite + React using the provided hooks and UI controls | Yes |
| [self-hosted](./self-hosted/) | Vite + self-hosted `processor.js` via `getProcessorModuleUrl()` | Yes |
