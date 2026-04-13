import { GlobalWindow } from "happy-dom";
import {
	AnalyserNode,
	AudioBuffer,
	AudioBufferSourceNode,
	AudioContext,
	AudioDestinationNode,
	AudioListener,
	AudioNode,
	AudioParam,
	AudioParamMap,
	AudioScheduledSourceNode,
	AudioWorklet,
	AudioWorkletNode,
	BaseAudioContext,
	BiquadFilterNode,
	ChannelMergerNode,
	ChannelSplitterNode,
	ConstantSourceNode,
	ConvolverNode,
	DelayNode,
	DynamicsCompressorNode,
	GainNode,
	IIRFilterNode,
	MediaStreamAudioSourceNode,
	OfflineAudioCompletionEvent,
	OfflineAudioContext,
	OscillatorNode,
	PannerNode,
	PeriodicWave,
	StereoPannerNode,
	WaveShaperNode,
} from "isomorphic-web-audio-api";

type ManagedAudioContext = AudioContext | OfflineAudioContext;

const registeredAudioContexts = new Set<ManagedAudioContext>();

function isClosableAudioContext(
	context: ManagedAudioContext,
): context is AudioContext {
	return typeof (context as AudioContext).close === "function";
}

function isAlreadyClosedError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const name = error.name.toLowerCase();
	const message = error.message.toLowerCase();
	return (
		name.includes("invalidstate") ||
		message.includes("closed") ||
		message.includes("cannot close")
	);
}

export function registerAudioContext<T extends ManagedAudioContext>(
	context: T,
): T {
	registeredAudioContexts.add(context);
	return context;
}

export function getRegisteredAudioContextCountForTest(): number {
	return registeredAudioContexts.size;
}

export async function closeRegisteredAudioContexts(): Promise<void> {
	const contexts = [...registeredAudioContexts];
	registeredAudioContexts.clear();

	for (const context of contexts) {
		if (!isClosableAudioContext(context)) {
			continue;
		}

		try {
			await context.close();
		} catch (error) {
			if (isAlreadyClosedError(error)) {
				continue;
			}
			throw error;
		}
	}
}

void (async () => {
	try {
		const { afterEach } = await import("bun:test");
		afterEach(async () => {
			await closeRegisteredAudioContexts();
		});
	} catch {
		// Ignore when this preload is imported outside Bun's test runner.
	}
})();

globalThis.AnalyserNode ??= AnalyserNode;
globalThis.AudioBuffer ??= AudioBuffer;
globalThis.AudioBufferSourceNode ??= AudioBufferSourceNode;
globalThis.AudioContext ??= AudioContext;
globalThis.AudioDestinationNode ??= AudioDestinationNode;
globalThis.AudioListener ??= AudioListener;
globalThis.AudioNode ??= AudioNode;
globalThis.AudioParam ??= AudioParam;
globalThis.AudioParamMap ??= AudioParamMap;
globalThis.AudioScheduledSourceNode ??= AudioScheduledSourceNode;
globalThis.AudioWorklet ??= AudioWorklet;
globalThis.AudioWorkletNode ??= AudioWorkletNode;
globalThis.BaseAudioContext ??= BaseAudioContext;
globalThis.BiquadFilterNode ??= BiquadFilterNode;
globalThis.ChannelMergerNode ??= ChannelMergerNode;
globalThis.ChannelSplitterNode ??= ChannelSplitterNode;
globalThis.ConstantSourceNode ??= ConstantSourceNode;
globalThis.ConvolverNode ??= ConvolverNode;
globalThis.DelayNode ??= DelayNode;
globalThis.DynamicsCompressorNode ??= DynamicsCompressorNode;
globalThis.GainNode ??= GainNode;
globalThis.IIRFilterNode ??= IIRFilterNode;
globalThis.MediaStreamAudioSourceNode ??= MediaStreamAudioSourceNode;
globalThis.OfflineAudioCompletionEvent ??= OfflineAudioCompletionEvent;
globalThis.OfflineAudioContext ??= OfflineAudioContext;
globalThis.OscillatorNode ??= OscillatorNode;
globalThis.PannerNode ??= PannerNode;
globalThis.PeriodicWave ??= PeriodicWave;
globalThis.StereoPannerNode ??= StereoPannerNode;
globalThis.WaveShaperNode ??= WaveShaperNode;

// Install browser globals (document, navigator, location, window, etc.)
// from happy-dom so the engine code that touches the DOM doesn't crash in Bun.
const happyWindow = new GlobalWindow();
const browserGlobals = ["document", "navigator", "location", "window"] as const;

for (const key of browserGlobals) {
	if (globalThis[key] === undefined) {
		// @ts-expect-error - globalThis[key] is assignable
		globalThis[key] = happyWindow[key];
	}
}

// @ts-expect-error - readonly
globalThis.navigator.userActivation ??= {
	isActive: true,
	hasBeenActive: true,
};

/**
 * Try to create a real AudioContext; fall back to OfflineAudioContext when
 * no audio device is available (e.g. CI runners).
 */
/**
 * Create an AudioContext for tests.
 *
 * Defaults to OfflineAudioContext so that no native real-time audio thread is
 * spawned (node-web-audio-api / isomorphic-web-audio-api creates a live Rust
 * audio thread per AudioContext, and unclosed contexts accumulate rapidly
 * across a test suite, causing 800 %+ CPU saturation and timeouts).
 *
 * Pass `preferOffline: false` only when you explicitly need real-time
 * behaviour (e.g. testing AudioContext.state transitions).
 */
export function createContext(opts?: {
	sampleRate?: number;
	length?: number;
	channels?: number;
	/** @default true */
	preferOffline?: boolean;
}): AudioContext | OfflineAudioContext {
	const sampleRate = opts?.sampleRate ?? 44100;
	if (opts?.preferOffline !== false) {
		return registerAudioContext(
			new OfflineAudioContext(
				opts?.channels ?? 1,
				opts?.length ?? sampleRate,
				sampleRate,
			),
		);
	}
	try {
		return registerAudioContext(new AudioContext({ sampleRate }));
	} catch {
		return registerAudioContext(
			new OfflineAudioContext(
				opts?.channels ?? 1,
				opts?.length ?? sampleRate,
				sampleRate,
			),
		);
	}
}

/**
 * Run audio through the context and then clean up.
 * - OfflineAudioContext: calls startRendering()
 * - AudioContext: sleeps for the given duration then closes
 */
export async function renderContext(
	context: AudioContext | OfflineAudioContext,
	durationMs = 150,
): Promise<void> {
	if (context instanceof OfflineAudioContext) {
		await context.startRendering();
	} else {
		await Bun.sleep(durationMs);
		await context.close();
	}
}
