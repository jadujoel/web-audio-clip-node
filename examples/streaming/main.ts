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
const throttleSelect = document.getElementById("throttle-select") as HTMLSelectElement;
const progressBar = document.getElementById("progress") as HTMLDivElement;
const statusText = document.getElementById("status") as HTMLParagraphElement;
const controlsPanel = document.getElementById("controls") as HTMLDivElement;

// Control sliders
const gainSlider = document.getElementById("ctrl-gain") as HTMLInputElement;
const panSlider = document.getElementById("ctrl-pan") as HTMLInputElement;
const rateSlider = document.getElementById("ctrl-rate") as HTMLInputElement;
const detuneSlider = document.getElementById("ctrl-detune") as HTMLInputElement;
const lowpassSlider = document.getElementById("ctrl-lowpass") as HTMLInputElement;
const highpassSlider = document.getElementById(
	"ctrl-highpass",
) as HTMLInputElement;
const fadeInSlider = document.getElementById("ctrl-fadein") as HTMLInputElement;
const fadeOutSlider = document.getElementById(
	"ctrl-fadeout",
) as HTMLInputElement;
const loopCheckbox = document.getElementById("ctrl-loop") as HTMLInputElement;
const loopStartSlider = document.getElementById(
	"ctrl-loopstart",
) as HTMLInputElement;
const loopEndSlider = document.getElementById(
	"ctrl-loopend",
) as HTMLInputElement;
const crossfadeSlider = document.getElementById(
	"ctrl-crossfade",
) as HTMLInputElement;

// Value displays
const valGain = document.getElementById("val-gain") as HTMLSpanElement;
const valPan = document.getElementById("val-pan") as HTMLSpanElement;
const valRate = document.getElementById("val-rate") as HTMLSpanElement;
const valDetune = document.getElementById("val-detune") as HTMLSpanElement;
const valLowpass = document.getElementById("val-lowpass") as HTMLSpanElement;
const valHighpass = document.getElementById("val-highpass") as HTMLSpanElement;
const valFadeIn = document.getElementById("val-fadein") as HTMLSpanElement;
const valFadeOut = document.getElementById("val-fadeout") as HTMLSpanElement;
const valLoopStart = document.getElementById(
	"val-loopstart",
) as HTMLSpanElement;
const valLoopEnd = document.getElementById("val-loopend") as HTMLSpanElement;
const valCrossfade = document.getElementById(
	"val-crossfade",
) as HTMLSpanElement;

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

	// Apply current slider values to the new clip
	applyControls();

	// Show controls panel
	controlsPanel.style.display = "";
	pauseBtn.disabled = false;
	stopBtn.disabled = false;

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
	const throttle = Number(throttleSelect.value);
	worker.postMessage(
		{ type: "init", port: channel.port1, url: absoluteUrl, throttle },
		[channel.port1],
	);

	setStatus(throttle > 0 ? `Starting stream… (${(throttle / 1024).toFixed(0)} KB/s)` : "Starting stream…");
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

// ── Control wiring ───────────────────────────────────────────────────
function formatPan(v: number): string {
	if (Math.abs(v) < 0.005) return "C";
	return v < 0 ? `L ${(-v * 100).toFixed(0)}` : `R ${(v * 100).toFixed(0)}`;
}

function formatHz(v: number): string {
	return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v} Hz`;
}

function applyControls() {
	if (!clip) return;
	clip.gain.value = Number(gainSlider.value);
	clip.pan.value = Number(panSlider.value);
	clip.playbackRate.value = Number(rateSlider.value);
	clip.detune.value = Number(detuneSlider.value);
	clip.lowpass.value = Number(lowpassSlider.value);
	clip.highpass.value = Number(highpassSlider.value);
	clip.fadeIn = Number(fadeInSlider.value);
	clip.fadeOut = Number(fadeOutSlider.value);
	clip.loop = loopCheckbox.checked;
	clip.loopStart = Number(loopStartSlider.value);
	clip.loopEnd = Number(loopEndSlider.value);
	clip.loopCrossfade = Number(crossfadeSlider.value);
}

// Wire each slider to update the value display and the clip
gainSlider.addEventListener("input", () => {
	valGain.textContent = Number(gainSlider.value).toFixed(2);
	if (clip) clip.gain.value = Number(gainSlider.value);
});
panSlider.addEventListener("input", () => {
	valPan.textContent = formatPan(Number(panSlider.value));
	if (clip) clip.pan.value = Number(panSlider.value);
});
rateSlider.addEventListener("input", () => {
	valRate.textContent = `${Number(rateSlider.value).toFixed(2)}×`;
	if (clip) clip.playbackRate.value = Number(rateSlider.value);
});
detuneSlider.addEventListener("input", () => {
	valDetune.textContent = `${detuneSlider.value} ct`;
	if (clip) clip.detune.value = Number(detuneSlider.value);
});
lowpassSlider.addEventListener("input", () => {
	valLowpass.textContent = formatHz(Number(lowpassSlider.value));
	if (clip) clip.lowpass.value = Number(lowpassSlider.value);
});
highpassSlider.addEventListener("input", () => {
	valHighpass.textContent = formatHz(Number(highpassSlider.value));
	if (clip) clip.highpass.value = Number(highpassSlider.value);
});
fadeInSlider.addEventListener("input", () => {
	valFadeIn.textContent = `${Number(fadeInSlider.value).toFixed(2)} s`;
	if (clip) clip.fadeIn = Number(fadeInSlider.value);
});
fadeOutSlider.addEventListener("input", () => {
	valFadeOut.textContent = `${Number(fadeOutSlider.value).toFixed(2)} s`;
	if (clip) clip.fadeOut = Number(fadeOutSlider.value);
});
loopCheckbox.addEventListener("change", () => {
	if (clip) clip.loop = loopCheckbox.checked;
});
loopStartSlider.addEventListener("input", () => {
	valLoopStart.textContent = `${Number(loopStartSlider.value).toFixed(2)} s`;
	if (clip) clip.loopStart = Number(loopStartSlider.value);
});
loopEndSlider.addEventListener("input", () => {
	valLoopEnd.textContent = `${Number(loopEndSlider.value).toFixed(2)} s`;
	if (clip) clip.loopEnd = Number(loopEndSlider.value);
});
crossfadeSlider.addEventListener("input", () => {
	valCrossfade.textContent = `${Number(crossfadeSlider.value).toFixed(2)} s`;
	if (clip) clip.loopCrossfade = Number(crossfadeSlider.value);
});
