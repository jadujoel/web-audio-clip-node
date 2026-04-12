# Examples

Each subdirectory demonstrates a different integration path for `@jadujoel/web-audio-clip-node`.

> **Tip:** Use **Ogg Opus** encoded at **48 kHz** for best performance. Most browsers run Web Audio at 48 kHz internally; matching the source sample rate avoids resampling overhead on decode.

From the repository root, run every example with:

```sh
bun run examples
```

That command builds the local package, links the examples that need it, and serves the demo entry points.

| Example | Description | Build step? |
|---------|-------------|-------------|
| [cdn-vanilla](./cdn-vanilla/) | Single HTML file using the jsDelivr bundle and a generated demo clip | No |
| [cdn-opus-streaming](./cdn-opus-streaming/) | Single HTML file streaming Ogg Opus through ClipNode via CDN imports | No |
| [esm-bundler](./esm-bundler/) | Vite + TypeScript importing the package directly | Yes |
