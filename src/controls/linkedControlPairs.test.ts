import { describe, expect, it } from "vitest";
import { buildDefaults } from "./controlDefs";
import {
	getLinkedControlUpdates,
	loopLinkedControlPairs,
	transportLinkedControlPairs,
} from "./linkedControlPairs";

describe("getLinkedControlUpdates", () => {
	it("keeps the same offset when moving the first linked control", () => {
		const defaults = buildDefaults();
		defaults.values.stopDelay = 1;
		defaults.values.fadeOut = 3;
		defaults.maxs.stopDelay = 10;
		defaults.maxs.fadeOut = 10;

		const updates = getLinkedControlUpdates({
			pair: transportLinkedControlPairs[0],
			changedKey: "stopDelay",
			nextValue: 2.5,
			values: defaults.values,
			mins: defaults.mins,
			maxs: defaults.maxs,
		});

		expect(updates.stopDelay).toBe(2.5);
		expect(updates.fadeOut).toBe(4.5);
	});

	it("clamps both loop bounds together at the shared maximum", () => {
		const defaults = buildDefaults();
		defaults.values.loopStart = 3;
		defaults.values.loopEnd = 5;
		defaults.maxs.loopStart = 6;
		defaults.maxs.loopEnd = 6;

		const updates = getLinkedControlUpdates({
			pair: loopLinkedControlPairs[0],
			changedKey: "loopEnd",
			nextValue: 6,
			values: defaults.values,
			mins: defaults.mins,
			maxs: defaults.maxs,
		});

		expect(updates.loopStart).toBe(4);
		expect(updates.loopEnd).toBe(6);
	});
});
