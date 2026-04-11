import { processorCode } from "./processor-code";

const PACKAGE_NAME = "@jadujoel/web-audio-clip-node";
const PACKAGE_VERSION: string =
	typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0";

declare const __VERSION__: string | undefined;

/** Blob URL from embedded processor code. Zero-config, default for npm users. */
export function getProcessorBlobUrl(): string {
	const blob = new Blob([processorCode], { type: "text/javascript" });
	return URL.createObjectURL(blob);
}

/** jsDelivr CDN URL. For script-tag / no-bundler usage. */
export function getProcessorCdnUrl(version = PACKAGE_VERSION): string {
	return `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${version}/dist/processor.js`;
}

/** Custom URL relative to a base. For self-hosted processor.js. */
export function getProcessorModuleUrl(baseUrl = document.baseURI): string {
	return new URL("./processor.js", baseUrl).toString();
}
