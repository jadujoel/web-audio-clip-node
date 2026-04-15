export type AudioDecoderMode = "native" | "polyfill" | "unsupported";

export interface AudioDecoderPolyfillOptions {
	enabled?: boolean;
	loaderUrl: string;
	coreUrl: string;
	wasmUrl: string;
	timeoutMs?: number;
}

export function probeAudioDecoderSupport(): boolean {
	return typeof AudioDecoder !== "undefined";
}

/**
 * Wrap existing worker code with a bootstrap shim that:
 * 1. Queues incoming messages
 * 2. Loads AudioDecoder polyfill if native is unavailable
 * 3. Executes the original worker code
 * 4. Replays queued messages
 *
 * The loaderUrl script must, after importScripts + async init,
 * install `AudioDecoder` on the worker global scope.
 */
export function wrapWithPolyfillBootstrap(
	originalCode: string,
	options: AudioDecoderPolyfillOptions,
): string {
	const loaderUrl = JSON.stringify(options.loaderUrl);
	const coreUrl = JSON.stringify(options.coreUrl);
	const wasmUrl = JSON.stringify(options.wasmUrl);
	const timeoutMs = options.timeoutMs ?? 15_000;

	// The bootstrap prefix queues messages, loads the polyfill, evaluates
	// the real decode worker IIFE, then replays the queue.
	return `(function(){
"use strict";
if(typeof AudioDecoder!=="undefined"){
${originalCode}
return;
}
var __q=[];
self.onmessage=function(e){__q.push(e)};
var __t=setTimeout(function(){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_TIMEOUT",message:"Polyfill load timed out after ${timeoutMs}ms"});
},${timeoutMs});
(async function(){
try{
importScripts(${coreUrl});
importScripts(${loaderUrl});
if(typeof LibAVWebCodecs!=="undefined"){
var __wasmBase=${wasmUrl}.replace(/\\/[^\\/]*$/,"");
await LibAVWebCodecs.load({polyfill:true,libavOptions:{noworker:true,nothreads:true,base:__wasmBase+"/",wasmurl:${wasmUrl}}});
}
if(typeof AudioDecoder==="undefined"){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_LOAD_FAILED",message:"Polyfill did not provide AudioDecoder"});
return;
}
}catch(e){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_LOAD_FAILED",message:"Failed to load polyfill: "+(e&&e.message||e)});
return;
}
clearTimeout(__t);
self.onmessage=null;
${originalCode}
var __h=self.onmessage;
if(__h){for(var i=0;i<__q.length;i++){__h.call(self,__q[i])}}
__q=null;
})();
})();
`;
}
