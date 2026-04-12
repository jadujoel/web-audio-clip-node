import { statSync } from "node:fs";
import { extname, join } from "node:path";

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
  routes: {
    "/": {
      GET() {
        return new Response(Bun.file("webpage/index.html"));
      }
    },
    "/*": {
      GET(req) {
        const pathname = new URL(req.url).pathname;
        return new Response(Bun.file(`webpage/${pathname}`));
      }
    }
  },
	async fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Serving webpage/ at http://127.0.0.1:${port}`);
