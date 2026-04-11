import "./TestPreload.ts";

import worker_threads from 'node:worker_threads';
console.log('worker_threads:', worker_threads.markAsUntransferable);
if (!worker_threads.markAsUntransferable) {
  worker_threads.markAsUntransferable = function(obj) {
    // In Bun, we just return the object and do nothing.
    // Note: This won't actually prevent transfer, it just prevents the crash.
    return obj;
  };
}

async function main() {
	const context = new AudioContext({ sampleRate: 48_000 });
	await Bun.build({
		entrypoints: ["src/audio/processor.ts"],
		outdir: "dist/audio",
	});
	await context.audioWorklet.addModule("./dist/audio/processor.js");
}

if (import.meta.main) {
	await main();
}
