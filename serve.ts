import { buildProcessor } from "./build.ts";
import index from "./src/index.html";

export function serve(): Bun.Server<unknown> {
	return Bun.serve({
		routes: {
			"/": index,
			"/index.html": index,
			"/processor.js": {
				async GET() {
					return new Response(await buildProcessor(), {
						headers: { "Content-Type": "application/javascript" },
					});
				},
			},
		},
	});
}

if (import.meta.main) {
	const server = serve();
	console.log(`Server running at ${server.hostname}:${server.port}`);
}
