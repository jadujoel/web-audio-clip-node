import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ControlKey } from "../controls/controlDefs";

const addModuleMock = mock(async () => undefined);
const decodeAudioDataMock = mock(
	async () => ({ duration: 1.5 }) as AudioBuffer,
);
const loadUploadedFileMock = mock(async () => ({
	name: "restored.wav",
	arrayBuffer: new ArrayBuffer(8),
}));
const saveUploadedFileMock = mock(async () => undefined);
const loadFromCacheMock = mock(async () => undefined);
const getProcessorBlobUrlMock = mock(() => "blob:test-processor");

mock.module("../audio/workletUrl", () => ({
	getProcessorBlobUrl: getProcessorBlobUrlMock,
}));

mock.module("../data/fileStore", () => ({
	loadUploadedFile: loadUploadedFileMock,
	saveUploadedFile: saveUploadedFileMock,
}));

mock.module("../data/cache", () => ({
	loadFromCache: loadFromCacheMock,
}));

const { useClipNode } = await import("./useClipNode");

function HookHarness() {
	useClipNode({
		values: {
			playhead: 0,
			offset: 0,
			duration: -1,
			startDelay: 0,
			stopDelay: 0,
			fadeIn: 0,
			fadeOut: 0,
			loopStart: 0,
			loopEnd: 0,
			loopCrossfade: 0,
			playbackRate: 1,
			detune: 0,
			gain: 0,
			pan: 0,
			lowpass: 16384,
			highpass: 32,
		},
		enabled: {
			playhead: true,
			offset: true,
			duration: true,
			startDelay: true,
			stopDelay: true,
			fadeIn: true,
			fadeOut: true,
			loopStart: true,
			loopEnd: true,
			loopCrossfade: true,
			playbackRate: true,
			detune: true,
			gain: true,
			pan: true,
			lowpass: true,
			highpass: true,
		},
		loop: false,
		setValue: (_key: ControlKey, _value: number) => {},
	});

	return null;
}

describe("useClipNode", () => {
	const OriginalAudioContext = globalThis.AudioContext;
	const OriginalRequestAnimationFrame = globalThis.requestAnimationFrame;
	const OriginalCancelAnimationFrame = globalThis.cancelAnimationFrame;

	beforeEach(() => {
		addModuleMock.mockClear();
		decodeAudioDataMock.mockClear();
		loadUploadedFileMock.mockClear();
		loadFromCacheMock.mockClear();
		getProcessorBlobUrlMock.mockClear();

		globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
			const id = setTimeout(() => callback(0), 0);
			return id as unknown as number;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = ((id: number) => {
			clearTimeout(id);
		}) as typeof cancelAnimationFrame;

		class MockAudioContext {
			audioWorklet = { addModule: addModuleMock };
			outputLatency = 0;
			baseLatency = 0;
			sampleRate = 48000;

			decodeAudioData = decodeAudioDataMock;
		}

		globalThis.AudioContext =
			MockAudioContext as unknown as typeof AudioContext;
	});

	afterEach(() => {
		cleanup();
		globalThis.AudioContext = OriginalAudioContext;
		globalThis.requestAnimationFrame = OriginalRequestAnimationFrame;
		globalThis.cancelAnimationFrame = OriginalCancelAnimationFrame;
	});

	test("restores uploaded files without requesting a self-hosted processor route", async () => {
		render(<HookHarness />);

		await waitFor(() => {
			expect(loadUploadedFileMock).toHaveBeenCalled();
			expect(getProcessorBlobUrlMock).toHaveBeenCalled();
			expect(addModuleMock).toHaveBeenCalledWith("blob:test-processor");
			expect(decodeAudioDataMock).toHaveBeenCalled();
		});
	});
});
