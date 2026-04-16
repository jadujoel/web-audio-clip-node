import type {
	AudioDecoderPolyfillOptions,
	ControlKey,
	LoopMode,
} from "./clip-node-lib";
import { useStreamingClipNode as useStreamingClipNodeLib } from "./clip-node-lib";

function getPolyfillOptions(): AudioDecoderPolyfillOptions {
	// Always provide polyfill URLs — the worker bootstrap checks whether the
	// native AudioDecoder supports the requested codec and only loads the
	// polyfill when needed (e.g. Safari 14 has no AudioDecoder at all).
	const pathParts = location.pathname.replace(/\/+$/, "").split("/");
	pathParts.pop(); // remove current page segment (e.g. "streaming")
	const base = `${location.origin}${pathParts.join("/")}/polyfill`;
	return {
		enabled: true,
		loaderUrl: `${base}/libavjs-webcodecs-polyfill.js`,
		coreUrl: `${base}/libav-6.8.8.0-webcodecs.js`,
		wasmUrl: `${base}/libav-6.8.8.0-webcodecs.wasm.wasm`,
		timeoutMs: 30_000,
	};
}

interface UseStreamingClipNodeParams {
	values: Record<ControlKey, number>;
	enabled: Record<ControlKey, boolean>;
	loop: boolean;
	loopMode: LoopMode;
	setValue: (key: ControlKey, val: number) => void;
}

export function useStreamingClipNode(params: UseStreamingClipNodeParams) {
	return useStreamingClipNodeLib({
		...params,
		polyfillOptions: getPolyfillOptions(),
	});
}
