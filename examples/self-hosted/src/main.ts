import { ClipNode, getProcessorModuleUrl } from "@jadujoel/web-audio-clip-node";

const app = document.getElementById("app")!;
app.innerHTML = `
  <h1>ClipNode – Self-Hosted Processor</h1>
  <p>The <code>processor.js</code> file is served from <code>/processor.js</code> on your own server.</p>
  <button id="play">▶ Play</button>
  <button id="stop">■ Stop</button>
  <p id="status">Click Play to start.</p>
`;

function createToneBuffer(ctx: AudioContext, freq = 440, duration = 2) {
	const length = ctx.sampleRate * duration;
	const buf = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < length; i++) {
		data[i] = Math.sin((2 * Math.PI * freq * i) / ctx.sampleRate);
	}
	return buf;
}

let ctx: AudioContext;
let clip: ClipNode;

document.getElementById("play")!.addEventListener("click", async () => {
	if (!ctx) {
		ctx = new AudioContext();
		// Load the processor from your own server (public/processor.js)
		const processorUrl = getProcessorModuleUrl(window.location.href);
		await ctx.audioWorklet.addModule(processorUrl);
		clip = new ClipNode(ctx, {
			processorOptions: { sampleRate: ctx.sampleRate },
		});
		clip.connect(ctx.destination);
		clip.buffer = createToneBuffer(ctx);
	}
	clip.start();
	document.getElementById("status")!.textContent = "Playing…";
});

document.getElementById("stop")!.addEventListener("click", () => {
	if (clip) {
		clip.stop();
		document.getElementById("status")!.textContent = "Stopped.";
	}
});
