import { describe, expect, test } from "vitest";
import { createContext } from "../../TestPreload";
import { Coordinator } from "./Coordinator";
import { StreamingClipNode } from "./StreamingClipNode";

describe("StreamingClipNode separate module (end-to-end)", () => {
	test("Coordinator creates nodes that are instances of the separated class", async () => {
		const ctx = createContext({ sampleRate: 48_000 });
		await ctx.audioWorklet.addModule("/dist/audio/processor.js");

		const coordinator = Coordinator.fromContext(ctx, {
			workerFactory: () => {
				throw new Error("worker should not be created in this test");
			},
			processorUrl: "/dist/audio/processor.js",
		});

		const node = coordinator.createStreamingClipNode();
		expect(node).toBeInstanceOf(StreamingClipNode);
	});
});
