// AudioWorklet processor for sidechain ducking — runs in AudioWorkletGlobalScope
// Bundled separately and served alongside the main processor.
// DSP logic lives in duck-processor-kernel.ts
import { createDuckProcessorState, processDuckBlock } from "./kernel";

export type DuckNodeParameterNames =
	| "threshold"
	| "attack"
	| "release"
	| "depth";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<DuckNodeParameterNames, Float32Array>,
	): boolean;
}

declare function registerProcessor(
	name: string,
	ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

class DuckProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: "threshold",
				automationRate: "a-rate" as const,
				defaultValue: 0.02,
				minValue: 0,
				maxValue: 1,
			},
			{
				name: "attack",
				automationRate: "a-rate" as const,
				defaultValue: 0.02,
				minValue: 0.001,
				maxValue: 1,
			},
			{
				name: "release",
				automationRate: "a-rate" as const,
				defaultValue: 0.6,
				minValue: 0.01,
				maxValue: 5,
			},
			{
				name: "depth",
				automationRate: "a-rate" as const,
				defaultValue: 0.8,
				minValue: 0,
				maxValue: 1,
			},
		] as const;
	}

	private state = createDuckProcessorState();
	private disposed = false;
	private bypassed = false;

	constructor(options?: AudioWorkletNodeOptions) {
		super(options);
		this.port.onmessage = (ev: MessageEvent) => {
			if (ev.data?.type === "dispose") {
				this.disposed = true;
				this.port.close();
			} else if (ev.data?.type === "bypass") {
				this.bypassed = ev.data.value;
			}
		};
	}

	override process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Readonly<Record<DuckNodeParameterNames, Float32Array>>,
	): boolean {
		if (this.disposed) return false;

		const mainInput = inputs[0] ?? [];
		const sidechain = inputs[1] ?? [];
		const output = outputs[0] ?? [];

		processDuckBlock(
			this.state,
			mainInput,
			sidechain,
			output,
			{
				threshold: parameters.threshold,
				attack: parameters.attack,
				release: parameters.release,
				depth: parameters.depth,
			},
			sampleRate,
			this.bypassed,
		);

		return true;
	}
}

registerProcessor("DuckProcessor", DuckProcessor);
