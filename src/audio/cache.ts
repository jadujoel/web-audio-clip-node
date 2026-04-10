const cachePromise = caches.open("sound-files");

export async function loadFromCache(
	url: string,
): Promise<ArrayBuffer | undefined> {
	const startTime = performance.now();
	const cache = await cachePromise;
	const response = await cache.match(url);
	if (response) {
		console.log(
			`[cache] Loaded ${url} from CacheStorage in ${(performance.now() - startTime).toFixed(0)}ms`,
		);
		return response.arrayBuffer();
	}
	const fetched = await fetch(url);
	if (fetched.ok) {
		cache.put(url, fetched.clone()).catch(() => {});
		console.log(
			`[cache] Loaded ${url} from network in ${(performance.now() - startTime).toFixed(0)}ms`,
		);
		return fetched.arrayBuffer();
	}
	return undefined;
}
