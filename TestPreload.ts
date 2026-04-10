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
