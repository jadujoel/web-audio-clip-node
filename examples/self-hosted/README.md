# Self-Hosted Processor Example

Demonstrates serving `processor.js` from your own origin instead of using the embedded blob URL or CDN.

```sh
bun install
bun run setup   # copies processor.js into public/
bun run dev
```

The `setup` script copies the worklet file from the installed package into `public/`, where Bun serves it as a static asset. `getProcessorModuleUrl()` resolves it relative to the page URL.
