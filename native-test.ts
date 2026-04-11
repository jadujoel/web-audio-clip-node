import "./TestPreload.ts";

import { ClipNode } from "./src/audio/ClipNode.ts";

async function main() {
	const context = new AudioContext({ sampleRate: 48_000 });
	await Bun.build({
		entrypoints: ["src/audio/processor.ts"],
		outdir: "dist/audio",
	});
	await context.audioWorklet.addModule("./dist/audio/processor.js");
	console.log("AudioWorkletProcessor module loaded successfully.");

  const srcFile = "./src/lml.webm";
  const convert = Bun.$`ffmpeg -i ${srcFile} -f wav -`;
  const wavData = await convert.arrayBuffer();
  console.log("Audio file converted to WAV format successfully.");
	const audioBuffer = await context.decodeAudioData(wavData);
  console.log("Audio file decoded successfully.");
  console.log(`AudioBuffer has ${audioBuffer.numberOfChannels} channel(s) and a length of ${audioBuffer.length} samples.`);
	const clip = new ClipNode(context);
	clip.buffer = audioBuffer;
	clip.start();

	// await context.close();
}

if (import.meta.main) {
	await main();
}
