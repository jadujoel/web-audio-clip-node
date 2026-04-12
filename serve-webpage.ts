import { extname } from "node:path";

const port = 4175;

Bun.serve({
	port,
	routes: {
		"/": {
			GET() {
				return new Response(Bun.file("webpage/index.html"));
			},
		},
		"/*": {
			GET(req) {
				let pathname = new URL(req.url).pathname;
				if (!extname(pathname)) {
					if (!pathname.endsWith("/")) {
						return new Response(null, {
							status: 302,
							headers: {
								Location: `${pathname}/`,
							},
						});
					}
					pathname += "/index.html";
				}
				console.info("serve", pathname);
				const filePath = `webpage${pathname}`;
				return new Response(Bun.file(filePath));
			},
		},
	},
	async fetch() {
		return new Response("Not Found", { status: 404 });
	},
});

console.log(`Serving webpage/ at http://127.0.0.1:${port}`);
