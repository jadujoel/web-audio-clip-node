export function getProcessorModuleUrl(baseUrl = document.baseURI): string {
	return new URL("./processor.js", baseUrl).toString();
}
