import { statSync } from "node:fs";
import { extname, join } from "node:path";

const webpageDir = join(import.meta.dir, "webpage");
const port = 4175;

const mimeTypes: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".mp3": "audio/mpeg",
	".opus": "audio/ogg",
	".webm": "audio/webm",
	".ogg": "audio/ogg",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
};

function getMime(path: string): string {
	return mimeTypes[extname(path)] ?? "application/octet-stream";
}

Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);
		const pathname = decodeURIComponent(url.pathname);

		// Try exact path first, then index.html for directories
		let filePath = join(webpageDir, pathname);
		try {
			const stat = statSync(filePath);
			if (stat.isDirectory()) {
				filePath = join(filePath, "index.html");
			}
		} catch {
			// not found, try .html extension
			if (!extname(pathname)) {
				filePath = `${filePath}.html`;
			}
		}

		const file = Bun.file(filePath);
		if (await file.exists()) {
			return new Response(file, {
				headers: { "Content-Type": getMime(filePath) },
			});
		}

		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Serving webpage/ at http://127.0.0.1:${port}`);
