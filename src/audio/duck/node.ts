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
	readonly sidechainInput: GainNode;

	constructor(context: BaseAudioContext, options: DuckNodeOptions = {}) {
		super(context, "DuckProcessor", {
			numberOfInputs: 2,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			parameterData: {
				...(options.threshold !== undefined && {
					threshold: options.threshold,
				}),
				...(options.attack !== undefined && { attack: options.attack }),
				...(options.release !== undefined && { release: options.release }),
				...(options.depth !== undefined && { depth: options.depth }),
			},
		});

		// A pass-through GainNode routed to the worklet's second input.
		// Users connect their sidechain signal to this node.
		this.sidechainInput = new GainNode(context);
		this.sidechainInput.connect(this, 0, 1);
	}

	get threshold(): AudioParam {
		return this.parameters.get("threshold")!;
	}

	get attack(): AudioParam {
		return this.parameters.get("attack")!;
	}

	get release(): AudioParam {
		return this.parameters.get("release")!;
	}

	get depth(): AudioParam {
		return this.parameters.get("depth")!;
	}

	dispose(): void {
		this.sidechainInput.disconnect();
		this.port.postMessage({ type: "dispose" });
		this.disconnect();
	}
}
