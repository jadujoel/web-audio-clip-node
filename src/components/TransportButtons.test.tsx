import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TransportButtons } from "./TransportButtons";

afterEach(cleanup);

describe("TransportButtons", () => {
	const noop = () => {};

	test("renders all buttons", () => {
		const { container } = render(
			<TransportButtons
				nodeState="initial"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const buttons = container.querySelectorAll("button");
		expect(buttons.length).toBe(7);
		const texts = Array.from(buttons).map((b) => b.textContent);
		expect(texts).toContain("Start");
		expect(texts).toContain("Stop");
		expect(texts).toContain("Pause");
		expect(texts).toContain("Resume");
		expect(texts).toContain("Dispose");
		expect(texts).toContain("Log State");
		expect(texts).toContain("Load Sound");
	});

	test("Start disabled when nodeState is 'started'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="started"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const startBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Start",
		) as HTMLButtonElement;
		expect(startBtn.disabled).toBe(true);
	});

	test("Stop disabled when nodeState is 'initial'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="initial"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const stopBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Stop",
		) as HTMLButtonElement;
		expect(stopBtn.disabled).toBe(true);
	});

	test("Stop disabled when nodeState is 'disposed'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="disposed"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const stopBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Stop",
		) as HTMLButtonElement;
		expect(stopBtn.disabled).toBe(true);
	});

	test("Stop disabled when nodeState is 'ended'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="ended"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const stopBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Stop",
		) as HTMLButtonElement;
		expect(stopBtn.disabled).toBe(true);
	});

	test("Pause disabled when nodeState is not 'started'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="paused"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const pauseBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Pause",
		) as HTMLButtonElement;
		expect(pauseBtn.disabled).toBe(true);
	});

	test("Resume disabled when nodeState is not 'paused'", () => {
		const { container } = render(
			<TransportButtons
				nodeState="started"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const resumeBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Resume",
		) as HTMLButtonElement;
		expect(resumeBtn.disabled).toBe(true);
	});

	test("clicking Start calls onStart", () => {
		const onStart = mock(() => {});
		const { container } = render(
			<TransportButtons
				nodeState="initial"
				onStart={onStart}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const startBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Start",
		);
		if (!startBtn) throw new Error("Start button not found");
		fireEvent.click(startBtn);
		expect(onStart).toHaveBeenCalled();
	});

	test("clicking Stop calls onStop", () => {
		const onStop = mock(() => {});
		const { container } = render(
			<TransportButtons
				nodeState="started"
				onStart={noop}
				onStop={onStop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={noop}
			/>,
		);
		const stopBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Stop",
		);
		if (!stopBtn) throw new Error("Stop button not found");
		fireEvent.click(stopBtn);
		expect(onStop).toHaveBeenCalled();
	});

	test("clicking Load Sound calls onLoadSound", () => {
		const onLoadSound = mock(() => {});
		const { container } = render(
			<TransportButtons
				nodeState="initial"
				onStart={noop}
				onStop={noop}
				onPause={noop}
				onResume={noop}
				onDispose={noop}
				onLog={noop}
				onLoadSound={onLoadSound}
			/>,
		);
		const btn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Load Sound",
		);
		if (!btn) throw new Error("Load Sound button not found");
		fireEvent.click(btn);
		expect(onLoadSound).toHaveBeenCalled();
	});
});
