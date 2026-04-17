import { useCallback, useRef, useState } from "react";
import { DuckNode, type DuckNodeOptions } from "../audio/duck/node";
import { getDuckProcessorBlobUrl } from "../audio/duck/url";

export interface DuckParams {
	/** Threshold in dBFS (-100 to 0). */
	threshold: number;
	attack: number;
	release: number;
	/** Depth in percent (0–100). */
	depth: number;
	enabled: boolean;
}

export const defaultDuckParams: DuckParams = {
	threshold: -40,
	attack: 0.01,
	release: 0.5,
	depth: 80,
	enabled: false,
};

export interface UseDuckNodeReturn {
	/** Call after AudioContext is created to register the worklet and create the node. */
	ensureNode: (ctx: AudioContext) => Promise<DuckNode>;
	/** Current DuckNode instance (null until ensureNode resolves). */
	node: DuckNode | null;
	/** Update a single parameter on the live node. */
	setParam: (key: keyof DuckNodeOptions, value: number) => void;
	/** Enable or disable ducking via the bypass parameter. */
	setEnabled: (enabled: boolean) => void;
	/** Dispose the node. */
	dispose: () => void;
}

export function useDuckNode(): UseDuckNodeReturn {
	const nodeRef = useRef<DuckNode | null>(null);
	const registeredRef = useRef(false);
	const [node, setNode] = useState<DuckNode | null>(null);

	const ensureNode = useCallback(async (ctx: AudioContext) => {
		if (nodeRef.current) return nodeRef.current;

		if (!registeredRef.current) {
			await ctx.audioWorklet.addModule(getDuckProcessorBlobUrl());
			registeredRef.current = true;
		}

		// Created with bypass=1 (bypassed) by default
		const duckNode = new DuckNode(ctx);
		nodeRef.current = duckNode;
		setNode(duckNode);
		return duckNode;
	}, []);

	const setParam = useCallback((key: keyof DuckNodeOptions, value: number) => {
		const n = nodeRef.current;
		if (!n) return;
		const param = n[key];
		if (param) {
			param.setValueAtTime(value, 0);
		}
	}, []);

	const setEnabled = useCallback((enabled: boolean) => {
		const n = nodeRef.current;
		if (!n) return;
		n.bypass = !enabled;
	}, []);

	const dispose = useCallback(() => {
		nodeRef.current?.dispose();
		nodeRef.current = null;
		setNode(null);
	}, []);

	return { ensureNode, node, setParam, setEnabled, dispose };
}
