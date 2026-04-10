import { describe, expect, it } from "bun:test";
import {
	allDefs,
	buildDefaults,
	controlDefs,
	loopControlDefs,
	paramDefs,
} from "./controlDefs";

describe("controlDefs", () => {
	it("controlDefs has expected keys", () => {
		const keys = controlDefs.map((d) => d.key);
		expect(keys).toContain("playhead");
		expect(keys).toContain("offset");
		expect(keys).toContain("duration");
	});

	it("loopControlDefs has loop-related keys", () => {
		const keys = loopControlDefs.map((d) => d.key);
		expect(keys).toContain("loopStart");
		expect(keys).toContain("loopEnd");
		expect(keys).toContain("loopCrossfade");
	});

	it("paramDefs has parameter keys", () => {
		const keys = paramDefs.map((d) => d.key);
		expect(keys).toContain("playbackRate");
		expect(keys).toContain("gain");
		expect(keys).toContain("pan");
		expect(keys).toContain("lowpass");
		expect(keys).toContain("highpass");
	});

	it("allDefs combines all definition arrays", () => {
		expect(allDefs.length).toBe(
			controlDefs.length + loopControlDefs.length + paramDefs.length,
		);
	});
});

describe("buildDefaults", () => {
	it("returns values, snaps, and enabled for all defs", () => {
		const { values, snaps, enabled } = buildDefaults();
		for (const def of allDefs) {
			expect(values[def.key]).toBe(def.defaultValue);
			expect(snaps[def.key]).toBe(def.snap ?? "none");
			expect(enabled[def.key]).toBe(true);
		}
	});
});
