# Self-Hosted Processor Example

Demonstrates serving `processor.js` from your own origin instead of using the embedded blob URL or CDN.

```sh
npm install
npm run setup   # copies processor.js into public/
npm run dev
```

The `setup` script copies the worklet file from the installed package into `public/`, where Vite serves it as a static asset. `getProcessorModuleUrl()` resolves it relative to the page URL.
