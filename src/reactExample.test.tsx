import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("React example", () => {
	test("wires transport and controls with explicit props", async () => {
		const source = await readFile(
			join(import.meta.dir, "../examples/react/src/App.tsx"),
			"utf8",
		);

		expect(source).toContain("nodeState={clip.nodeState}");
		expect(source).toContain("onLoadSound={clip.loadSound}");
		expect(source).toContain("value={controls.values.playbackRate}");
		expect(source).toContain("value={controls.values.gain}");
		expect(source).not.toContain("<TransportButtons />");
		expect(source).not.toContain("<AudioControl />");
	});
});
