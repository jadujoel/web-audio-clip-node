import { describe, expect, test } from "vitest";
import {
	closeRegisteredAudioContexts,
	getRegisteredAudioContextCountForTest,
	registerAudioContext,
} from "./TestPreload";

function createMockClosableContext(options?: {
	throwOnClose?: Error;
	onClose?: () => void;
}): AudioContext {
	const context = {
		state: "running",
		close: async () => {
			options?.onClose?.();
			if (options?.throwOnClose) {
				throw options.throwOnClose;
			}
			context.state = "closed";
		},
	} as unknown as AudioContext;

	return context;
}

describe("TestPreload audio context cleanup", () => {
	test("closes every registered context", async () => {
		let closedCount = 0;
		registerAudioContext(
			createMockClosableContext({
				onClose: () => {
					closedCount += 1;
				},
			}),
		);
		registerAudioContext(
			createMockClosableContext({
				onClose: () => {
					closedCount += 1;
				},
			}),
		);

		await closeRegisteredAudioContexts();

		expect(closedCount).toBe(2);
		expect(getRegisteredAudioContextCountForTest()).toBe(0);
	});

	test("swallows already-closed close errors", async () => {
		const error = new Error("cannot close because context is already closed");
		error.name = "InvalidStateError";
		registerAudioContext(
			createMockClosableContext({
				throwOnClose: error,
			}),
		);

		await closeRegisteredAudioContexts();

		expect(getRegisteredAudioContextCountForTest()).toBe(0);
	});

	test("auto-cleans leaked contexts between tests", () => {
		registerAudioContext(createMockClosableContext());
		expect(getRegisteredAudioContextCountForTest()).toBe(1);
	});

	test("starts each test with an empty registry", () => {
		expect(getRegisteredAudioContextCountForTest()).toBe(0);
	});
});
