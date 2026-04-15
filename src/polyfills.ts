if (Promise.withResolvers === undefined) {
	Promise.withResolvers = () => {
		let resolve: (value?: unknown) => void;
		let reject: (reason?: unknown) => void;
		const promise = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});
		// biome-ignore lint/style/noNonNullAssertion: we did define it.
		return { promise, resolve: resolve!, reject: reject! };
	};
}
