import "./TestPreload.ts";

import { ClipNode } from "./src/audio/ClipNode.ts";

async function main() {
	const context = new AudioContext({
		sampleRate: 48_000,
		latencyHint: "playback",
	});
	await Bun.build({
		entrypoints: ["src/audio/processor.ts"],
		outdir: "dist/audio",
	});
	await context.audioWorklet.addModule("./dist/audio/processor.js");
	console.log("AudioWorkletProcessor module loaded successfully.");

	const srcFile = "./src/lml.webm";
	const convert = Bun.$`ffmpeg -i ${srcFile} -f wav -`;
	const wavData = await convert.arrayBuffer();
	const audioBuffer = await context.decodeAudioData(wavData);
	const clip = new ClipNode(context);
	clip.buffer = audioBuffer;
	clip.start();
	clip.connect(context.destination);
	clip.loop = true;
	clip.playbackRate.setValueCurveAtTime(
		[1, -1, 2, 1],
		context.currentTime + 0.1,
		0.8,
	);

	await Bun.sleep(1_500);
	console.log("Closing context...");
	await context.close();
	console.log("Context Closed", context.state);
}

if (import.meta.main) {
	await main();
}
