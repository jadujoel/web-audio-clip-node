# CDN Vanilla Example

Single-file demo with no bundler and no local package install.

Everything loads from [jsDelivr](https://www.jsdelivr.com/), including the worklet processor. The page synthesizes its own clip so you can see pause/resume, reusable `start()` without recreating the node, live buffer swapping, loop callbacks, loop crossfade, sample-accurate fades, pan, rate, detune, and live playhead seeking without fetching any assets.

> **Note:** Opening the file directly with `file://` will not work because browsers treat local files as isolated origins and block the module/worklet loading path.

Serve this directory with any static server, for example:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

If you are already in the repository root, `bun run examples` also serves this page.
