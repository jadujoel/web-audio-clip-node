import { ClipNode, getProcessorBlobUrl } from "@jadujoel/web-audio-clip-node";
import { workerCode } from "./generated/worker-code";

function getWorkerBlobUrl(): string {
	const blob = new Blob([workerCode], { type: "application/javascript" });
	return URL.createObjectURL(blob);
}

// ── DOM references ───────────────────────────────────────────────────
const streamBtn = document.getElementById("stream") as HTMLButtonElement;
const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const progressBar = document.getElementById("progress") as HTMLDivElement;
const statusText = document.getElementById("status") as HTMLParagraphElement;

// ── State ────────────────────────────────────────────────────────────
let ctx: AudioContext | null = null;
let clip: ClipNode | null = null;
let worker: Worker | null = null;

// ── Helpers ──────────────────────────────────────────────────────────
function setStatus(msg: string) {
	statusText.textContent = msg;
}

function setProgress(ratio: number) {
	progressBar.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
}

// ── Stream & Play ────────────────────────────────────────────────────
streamBtn.addEventListener("click", async () => {
	const url = urlInput.value.trim();
	if (!url) {
		setStatus("Enter a URL first.");
		return;
	}

	// Tear down previous run
	if (worker) {
		worker.postMessage({ type: "abort" });
		worker.terminate();
		worker = null;
	}
	if (clip) {
		clip.stop();
		clip.disconnect();
		clip = null;
	}

	// Create AudioContext
	if (!ctx) {
		ctx = new AudioContext();
		await ctx.audioWorklet.addModule(getProcessorBlobUrl());
	} else {
		await ctx.resume();
	}

	// Create ClipNode
	clip = new ClipNode(ctx);
	clip.loop = true;
	clip.connect(ctx.destination);

	// Create MessageChannel: port1 → Worker, port2 → Processor
	const channel = new MessageChannel();

	// Transfer port2 to the processor via the ClipNode API (zero main-thread allocation)
	clip.transferPort(channel.port2);

	// Create and start decode worker from inline Blob URL
	worker = new Worker(getWorkerBlobUrl());

	worker.onmessage = (ev: MessageEvent) => {
		const { type } = ev.data;
		switch (type) {
			case "progress": {
				const { bytesReceived, totalBytes } = ev.data;
				if (totalBytes) {
					setProgress(bytesReceived / totalBytes);
					setStatus(
						`Downloading… ${((bytesReceived / 1024) | 0)} / ${((totalBytes / 1024) | 0)} KB`,
					);
				} else {
					setStatus(`Downloading… ${((bytesReceived / 1024) | 0)} KB`);
				}
				break;
			}
			case "decoded": {
				const { samplesDecoded } = ev.data;
				if (samplesDecoded > 0 && clip && clip.state === "initial") {
					clip.start();
					setStatus("Streaming & playing…");
				}
				break;
			}
			case "info": {
				setStatus(`Decoding: ${ev.data.sampleRate} Hz, ${ev.data.channels} ch`);
				break;
			}
			case "done": {
				setStatus(`Done — ${ev.data.samplesDecoded} samples decoded.`);
				setProgress(1);
				break;
			}
			case "error": {
				setStatus(`Error: ${ev.data.message}`);
				break;
			}
			case "aborted": {
				setStatus("Aborted.");
				break;
			}
		}
	};

	// Init the worker with the port and absolute URL
	const absoluteUrl = new URL(url, location.href).href;
	worker.postMessage(
		{ type: "init", port: channel.port1, url: absoluteUrl },
		[channel.port1],
	);

	setStatus("Starting stream…");
	setProgress(0);
});

// ── Transport controls ───────────────────────────────────────────────
pauseBtn.addEventListener("click", () => {
	if (!clip || !ctx) return;
	if (clip.state === "playing" || clip.state === "started") {
		clip.pause();
		setStatus("Paused.");
	} else if (clip.state === "paused") {
		clip.start();
		setStatus("Resumed.");
	}
});

stopBtn.addEventListener("click", () => {
	if (!clip) return;
	clip.stop();
	if (worker) {
		worker.postMessage({ type: "abort" });
		worker.terminate();
		worker = null;
	}
	setProgress(0);
	setStatus("Stopped.");
});
