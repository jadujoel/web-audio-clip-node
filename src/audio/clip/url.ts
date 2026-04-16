import { VERSION } from "../version";
import { processorCode } from "./code";

const PACKAGE_NAME = "@jadujoel/web-audio-clip-node";
const PACKAGE_VERSION: string = VERSION;

/** Blob URL from embedded processor code. Zero-config, default for npm users. */
export function getProcessorBlobUrl(): string {
	const blob = new Blob([processorCode], { type: "text/javascript" });
	return URL.createObjectURL(blob);
}

/** jsDelivr CDN URL. For script-tag / no-bundler usage. */
export function getProcessorCdnUrl(version: string = PACKAGE_VERSION): string {
	return `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${version}/dist/clip-processor.bundle.js`;
}

/** Custom URL relative to a base. For self-hosted clip-processor.bundle.js. */
export function getProcessorModuleUrl(
	baseUrl: string = document.baseURI,
): string {
	return new URL("./clip-processor.bundle.js", baseUrl).toString();
}
