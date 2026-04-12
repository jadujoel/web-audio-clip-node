import { describe, expect, it } from "bun:test";
import { getDefaultUrlForFormat } from "./streamFormat";

describe("streamFormat", () => {
	it("returns format defaults", () => {
		expect(getDefaultUrlForFormat("OggOpus")).toBe("../sounds/example.opus");
		expect(getDefaultUrlForFormat("RawOpusFramed")).toBe("../sounds/example.fopus");
		expect(getDefaultUrlForFormat("WebmOpus")).toBe("../sounds/example.webm");
		expect(getDefaultUrlForFormat("Mp3")).toBe(
			"../sounds/example.mp3",
		);
	});
});
