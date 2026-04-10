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
		expect(keys).toContain("offset");
		expect(keys).toContain("duration");
		expect(keys).not.toContain("playhead");
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

	it("allDefs combines all definition arrays plus playhead", () => {
		expect(allDefs.length).toBe(
			1 + controlDefs.length + loopControlDefs.length + paramDefs.length,
		);
		const keys = allDefs.map((d) => d.key);
		expect(keys).toContain("playhead");
	});
});

describe("buildDefaults", () => {
	it("returns values, snaps, enabled, mins, maxs, and maxLocked for all defs", () => {
		const { values, snaps, enabled, mins, maxs, maxLocked } = buildDefaults();
		for (const def of allDefs) {
			expect(values[def.key]).toBe(def.defaultValue);
			expect(snaps[def.key]).toBe(def.snap ?? "none");
			expect(enabled[def.key]).toBe(true);
			expect(mins[def.key]).toBe(def.min);
			expect(maxs[def.key]).toBe(def.max);
			expect(maxLocked[def.key]).toBe(true);
		}
	});
});
