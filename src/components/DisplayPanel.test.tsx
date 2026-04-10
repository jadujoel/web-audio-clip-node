import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { DisplayPanel } from "./DisplayPanel";

afterEach(cleanup);

describe("DisplayPanel", () => {
	test("renders all info fields", () => {
		const { container } = render(
			<DisplayPanel
				nodeState="initial"
				statusMessage={null}
				currentTime="1.234"
				currentFrame="5678"
				timesLooped="3"
				latency="10ms"
				timeTaken="0.5ms"
			/>,
		);
		const outputs = container.querySelectorAll("output");
		const texts = Array.from(outputs).map((o) => o.textContent);
		expect(texts).toContain("initial");
		expect(texts).toContain("1.234");
		expect(texts).toContain("5678");
		expect(texts).toContain("3");
		expect(texts).toContain("10ms");
		expect(texts).toContain("0.5ms");
	});

	test("renders status message when provided", () => {
		const { container } = render(
			<DisplayPanel
				nodeState="started"
				statusMessage="Loading..."
				currentTime="0"
				currentFrame="0"
				timesLooped="0"
				latency="unknown"
				timeTaken="unknown"
			/>,
		);
		const alert = container.querySelector('[role="alert"]');
		expect(alert?.textContent).toBe("Loading...");
	});

	test("does not render status message when null", () => {
		const { container } = render(
			<DisplayPanel
				nodeState="started"
				statusMessage={null}
				currentTime="0"
				currentFrame="0"
				timesLooped="0"
				latency="unknown"
				timeTaken="unknown"
			/>,
		);
		const alert = container.querySelector('[role="alert"]');
		expect(alert).toBeNull();
	});
});
