import { describe, expect, test } from "bun:test";
import {
	applyBufferRangeWrite,
	getProperties,
	processBlock,
} from "./processor-kernel";
import { State } from "./types";

describe("float32 streaming pipeline (end-to-end)", () => {
	test("applies float32 bufferRange writes and exposes correct samples", () => {
		const sampleRate = 48_000;
		const props = getProperties({}, sampleRate);
		props.state = State.Initial;
		// Set up a small streaming buffer and apply a write immediately via applyBufferRangeWrite
		props.buffer = [new Float32Array(5), new Float32Array(5)];
		props.streamBuffer.streamingActive = true;
		const sampleValues = [-1, -0.5, 0, 0.5, 32767 / 32768];
		applyBufferRangeWrite(props, {
			startSample: 0,
			channelData: [new Float32Array(sampleValues)],
		});

		const outputs = [[new Float32Array(128)]];
		const parameters = {
			playbackRate: new Float32Array([1]),
			detune: new Float32Array([0]),
			lowpass: new Float32Array([20_000]),
			highpass: new Float32Array([20]),
			gain: new Float32Array([1]),
			pan: new Float32Array([0]),
		};
		processBlock(
			props,
			outputs,
			parameters,
			{ currentTime: 0, currentFrame: 0, sampleRate },
			{ lowpass: [], highpass: [] },
		);

		expect(props.streamBuffer.committedLength).toBe(5);
		expect(props.buffer[0]?.[0]).toBeCloseTo(-1, 5);
		expect(props.buffer[0]?.[1]).toBeCloseTo(-0.5, 5);
		expect(props.buffer[0]?.[2]).toBeCloseTo(0, 5);
		expect(props.buffer[0]?.[3]).toBeCloseTo(0.5, 5);
		expect(props.buffer[0]?.[4]).toBeCloseTo(32767 / 32768, 5);
	});
});
