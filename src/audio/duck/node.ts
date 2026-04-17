import type { DuckNodeParameterNames } from "./processor";

export interface DuckNodeOptions {
	/** Trigger level above which ducking activates (0–1). Default 0.02. */
	threshold?: number;
	/** How fast ducking kicks in, in seconds. Default 0.02. */
	attack?: number;
	/** How fast volume restores after trigger disappears, in seconds. Default 0.6. */
	release?: number;
	/** Maximum gain reduction (0 = no duck, 1 = full silence). Default 0.8. */
	depth?: number;
	/** Lookahead in seconds (0–0.05). Delays the main signal so ducking engages before the transient arrives. Default 0. */
	lookAhead?: number;
}

/**
 * Sidechain ducking node.
 *
 * Route the signal to duck through the node's default input (input 0).
 * Connect the trigger/sidechain signal to `sidechainInput` (input 1).
 *
 * ```
 * music.connect(duckNode);
 * voice.connect(duckNode.sidechainInput);
 * duckNode.connect(ctx.destination);
 * ```
 */
export class DuckNode extends AudioWorkletNode {
	readonly sidechain: GainNode;
	override readonly parameters: ReadonlyMap<
		DuckNodeParameterNames,
		AudioParam
	> = super.parameters as ReadonlyMap<DuckNodeParameterNames, AudioParam>;
	private _bypass = false;
	private _reduction = 0;

	constructor(context: BaseAudioContext, options: DuckNodeOptions = {}) {
		super(context, "DuckProcessor", {
			numberOfInputs: 2,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			parameterData: {
				...options,
			},
		});

		// A pass-through GainNode routed to the worklet's second input.
		// Users connect their sidechain signal to this node.
		this.sidechain = new GainNode(context);
		this.sidechain.connect(this, 0, 1);

		this.port.onmessage = (ev: MessageEvent) => {
			if (ev.data?.type === "reduction") {
				this._reduction = ev.data.value;
			}
		};
	}

	get threshold(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by processor definition
		return this.parameters.get("threshold")!;
	}

	get attack(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by processor definition
		return this.parameters.get("attack")!;
	}

	get release(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by processor definition
		return this.parameters.get("release")!;
	}

	get depth(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by processor definition
		return this.parameters.get("depth")!;
	}

	get lookAhead(): AudioParam {
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by processor definition
		return this.parameters.get("lookAhead")!;
	}

	/** Last-reported gain reduction in dB (0 = no reduction, negative = ducking). */
	get reduction(): number {
		return this._reduction;
	}

	/** Query the current gain reduction from the processor. Resolves with dB value. */
	requestReduction(): Promise<number> {
		return new Promise((resolve) => {
			const handler = (ev: MessageEvent) => {
				if (ev.data?.type === "reduction") {
					this._reduction = ev.data.value;
					this.port.removeEventListener("message", handler);
					resolve(ev.data.value);
				}
			};
			this.port.addEventListener("message", handler);
			this.port.postMessage({ type: "getReduction" });
		});
	}

	get bypass() {
		return this._bypass;
	}
	set bypass(value: boolean) {
		if (this._bypass !== value) {
			this._bypass = value;
			this.port.postMessage({ type: "bypass", value });
		}
	}

	dispose(): void {
		this.sidechain.disconnect();
		this.port.postMessage({ type: "dispose" });
		this.disconnect();
	}
}
