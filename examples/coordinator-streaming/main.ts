import { Coordinator } from "@jadujoel/web-audio-clip-node";

const btn = document.getElementById("start") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;

async function main() {
  const context: AudioContext = new AudioContext({ sampleRate: 48000 });
  const coordinator: Coordinator = Coordinator.fromContext(context);
  await coordinator.addModule();
  const clip = coordinator.ClipNode();
  clip.connect(context.destination);

  clip.onprogress = (bytes) => {
    const kb = (bytes / 1024) | 0;
    setStatus(`Downloading... ${kb} KB`);
  };
  clip.ondone = () => setStatus("Stream Downloaded.");
  clip.onerror = (msg) => setStatus(`Error: ${msg}`);
  clip.onstarted = () => setStatus("Streaming...");
  clip.onended = () => setStatus("Stream Ended.");

  btn.onclick = async () => {
    clip.url ??= "https://jadujoel.github.io/web-audio-clip-node/sounds/example.opus";
    if (clip.state !== "started") {
      await context.resume();
      clip.start();
      btn.innerText = "Stop";
    } else {
      btn.innerText = "Start";
      clip.stop()
    }
  };
}

function setStatus(text: string) {
	status.textContent = text;
}

main()
