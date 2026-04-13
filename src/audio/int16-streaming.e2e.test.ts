import { describe, expect, test } from "bun:test";
import { getProperties, processBlock } from "./processor-kernel";
import { State } from "./types";

describe("int16 streaming pipeline (end-to-end)", () => {
	test("applies int16 bufferRange writes and exposes normalized float samples", () => {
		const sampleRate = 48_000;
		const props = getProperties({}, sampleRate);
		props.state = State.Initial;
		props.streamBuffer.pendingWrites.push({
			startSample: 0,
			channelData: [new Int16Array([-32768, -16384, 0, 16384, 32767])],
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
