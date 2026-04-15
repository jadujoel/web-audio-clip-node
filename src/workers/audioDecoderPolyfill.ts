export type AudioDecoderMode = "native" | "polyfill" | "unsupported";

export interface AudioDecoderPolyfillOptions {
	enabled?: boolean;
	loaderUrl: string;
	coreUrl: string;
	wasmUrl: string;
	timeoutMs?: number;
	/**
	 * When set, the bootstrap checks `AudioDecoder.isConfigSupported` for this
	 * codec string.  If the native decoder exists but does NOT support the
	 * codec (e.g. "flac" on Safari), the polyfill is loaded anyway.
	 */
	codec?: string;
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
	const codec = options.codec ? JSON.stringify(options.codec) : "null";

	// The bootstrap prefix queues messages while it checks whether the
	// native AudioDecoder can handle the requested codec.  If it cannot
	// (or if AudioDecoder is missing entirely), the polyfill is loaded.
	//
	// Note: Some codecs (e.g. "flac") require a `description` buffer in
	// their config for `isConfigSupported` to return true on Safari.  We
	// provide a minimal dummy description so the probe succeeds.
	return `(function(){
"use strict";
var __q=[];
self.onmessage=function(e){__q.push(e)};
(async function(){
var __needPolyfill=false;
var __nativeExists=typeof AudioDecoder!=="undefined";
if(!__nativeExists){
__needPolyfill=true;
}else if(${codec}){
try{
var __cfg={codec:${codec},sampleRate:44100,numberOfChannels:2};
var __r=await AudioDecoder.isConfigSupported(__cfg);
if(!__r.supported){
__cfg.description=new Uint8Array(0);
__r=await AudioDecoder.isConfigSupported(__cfg);
}
if(!__r.supported)__needPolyfill=true;
}catch(e){/* check threw — assume native works */}
}
if(__needPolyfill){
var __t=setTimeout(function(){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_TIMEOUT",message:"Polyfill load timed out after ${timeoutMs}ms"});
},${timeoutMs});
try{
var __wasmBase=${wasmUrl}.replace(/\\/[^\\/]*$/,"");
importScripts(${coreUrl});
if(typeof LibAV!=="undefined"){LibAV.base=__wasmBase}
importScripts(${loaderUrl});
if(typeof LibAVWebCodecs!=="undefined"){
var __nowasm=false;
try{new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,12,1,0]))}catch(e){__nowasm=true}
var __opts={noworker:true,nothreads:true,base:__wasmBase+"/"};
if(!__nowasm){__opts.wasmurl=${wasmUrl}}else{__opts.nowasm=true}
await LibAVWebCodecs.load({polyfill:true,libavOptions:__opts});
if(__nativeExists&&typeof LibAVWebCodecs.AudioDecoder!=="undefined"){
self.AudioDecoder=LibAVWebCodecs.AudioDecoder;
}
}
if(typeof AudioDecoder==="undefined"){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_LOAD_FAILED",message:"Polyfill did not provide AudioDecoder"});
return;
}
clearTimeout(__t);
}catch(e){
self.postMessage({type:"error",code:"AUDIO_DECODER_POLYFILL_LOAD_FAILED",message:"Failed to load polyfill: "+(e&&e.message||e)});
return;
}
}
self.onmessage=null;
${originalCode}
var __h=self.onmessage;
if(__h){for(var i=0;i<__q.length;i++){__h.call(self,__q[i])}}
__q=null;
})();
})();
`;
}
