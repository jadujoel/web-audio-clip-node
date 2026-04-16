import { duckProcessorCode } from "./code";

/** Blob URL from embedded duck processor code. */
export function getDuckProcessorBlobUrl(): string {
	const blob = new Blob([duckProcessorCode], { type: "text/javascript" });
	return URL.createObjectURL(blob);
}
