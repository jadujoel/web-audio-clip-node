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
if (Array.prototype.at === undefined) {
	Array.prototype.at = function (index) {
		const len = this.length;
		const relativeIndex = Math.trunc(index) || 0;
		const k = relativeIndex >= 0 ? relativeIndex : len + relativeIndex;
		if (k < 0 || k >= len) return undefined;
		return this[k];
	};
}
