// AudioWorklet processor — runs in AudioWorkletGlobalScope
// Bundled separately and served at /processor.js
// This is a thin shell — all DSP logic lives in processor-kernel.ts

declare const currentTime: number;
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean;
}

declare function registerProcessor(
	name: string,
	ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

import {
	applyBufferRangeWrite,
	createFilterState,
	getProperties,
	handleProcessorMessage,
	processBlock,
} from "./kernel";
import type { ClipProcessorOptions, ProcessorWorkletOptions } from "./types";
import { State } from "./types";

class ClipProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: "playbackRate",
				automationRate: "a-rate" as const,
				defaultValue: 1.0,
			},
			{ name: "detune", automationRate: "a-rate" as const, defaultValue: 0 },
			{
				name: "gain",
				automationRate: "a-rate" as const,
				defaultValue: 1,
				minValue: 0,
			},
			{ name: "pan", automationRate: "a-rate" as const, defaultValue: 0 },
			{
				name: "highpass",
				automationRate: "a-rate" as const,
				defaultValue: 20,
				minValue: 20,
				maxValue: 20000,
			},
			{
				name: "lowpass",
				automationRate: "a-rate" as const,
				defaultValue: 20000,
				minValue: 20,
				maxValue: 20000,
			},
		];
	}

	properties: Required<ClipProcessorOptions>;
	private filterState = {
		lowpass: createFilterState(),
		highpass: createFilterState(),
	};
	private lastFrameTime = 0;
	/** Throttle bufferState postMessage to ≤10/sec (100ms minimum interval). */
	private lastBufferStateReportMs = -Infinity;

	private _reportBufferStateThrottled(): void {
		const nowMs = currentTime * 1000;
		if (nowMs - this.lastBufferStateReportMs < 100) return;
		this.lastBufferStateReportMs = nowMs;
		this.port.postMessage({
			type: "bufferState",
			data: {
				committedLength: this.properties.streamBuffer.committedLength,
				totalLength: this.properties.streamBuffer.totalLength,
				streamEnded: this.properties.streamBuffer.streamEnded,
			},
		});
	}

	constructor(options?: ProcessorWorkletOptions) {
		super(options);
		this.properties = getProperties(options?.processorOptions, sampleRate);
		this.port.onmessage = (ev: MessageEvent) => {
			if (ev.data.type === "transferPort") {
				const port = ev.data.data as MessagePort;
				port.onmessage = (portEv: MessageEvent) => {
					if (portEv.data.type === "bufferRange") {
						// Apply writes immediately in onmessage — before the next process() call.
						// This keeps process() free of variable-duration write work.
						applyBufferRangeWrite(this.properties, portEv.data.data);
						this._reportBufferStateThrottled();
						return;
					}
					const messages = handleProcessorMessage(
						this.properties,
						portEv.data,
						currentTime,
						sampleRate,
					);
					for (const msg of messages) this.port.postMessage(msg);
				};
				return;
			}
			const messages = handleProcessorMessage(
				this.properties,
				ev.data,
				currentTime,
				sampleRate,
			);
			for (const msg of messages) this.port.postMessage(msg);
			if (this.properties.state === State.Disposed) this.port.close();
		};
	}

	override process(
		_inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>,
	): boolean {
		try {
			const result = processBlock(
				this.properties,
				outputs,
				parameters,
				{ currentTime, currentFrame, sampleRate },
				this.filterState,
			);
			for (const msg of result.messages) this.port.postMessage(msg);

			// Frame reporting
			const timeTaken = currentTime - this.lastFrameTime;
			this.lastFrameTime = currentTime;
			if (this.properties.enableFrameReporting) {
				this.port.postMessage({
					type: "frame",
					data: [
						currentTime,
						currentFrame,
						Math.floor(this.properties.playhead),
						timeTaken * 1000,
					],
				});
			}

			return result.keepAlive;
		} catch (e) {
			this.port.postMessage({
				type: "processorError",
				data: {
					error: String(e),
					state: this.properties.state,
					bufferChannels: this.properties.buffer?.length,
					bufferLength: this.properties.buffer?.[0]?.length,
					paramKeys: Object.keys(parameters),
					hasPlaybackRate: !!parameters.playbackRate,
					hasDetune: !!parameters.detune,
					hasGain: !!parameters.gain,
					hasPan: !!parameters.pan,
					outputChannels: outputs[0]?.length,
				},
			});
			return true;
		}
	}
}

registerProcessor("ClipProcessor", ClipProcessor);
