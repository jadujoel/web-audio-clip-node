/**
 * Vitest browser-mode setup file.
 *
 * Runs inside the real browser, so all Web Audio and DOM APIs are native.
 * No need for isomorphic-web-audio-api or happy-dom.
 */
import { afterEach } from "vitest";
import { closeRegisteredAudioContexts } from "./TestPreload";

afterEach(async () => {
	await closeRegisteredAudioContexts();
});
