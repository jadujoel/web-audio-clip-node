import type { DuckNodeParameterNames } from "./processor";

export interface DuckNodeOptions {
	/** Trigger level above which ducking activates (0–1). Default 0.01. */
	threshold?: number;
	/** How fast ducking kicks in, in seconds. Default 0.01. */
	attack?: number;
	/** How fast volume restores after trigger disappears, in seconds. Default 0.5. */
	release?: number;
	/** Maximum gain reduction (0 = no duck, 1 = full silence). Default 0.8. */
	depth?: number;
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
