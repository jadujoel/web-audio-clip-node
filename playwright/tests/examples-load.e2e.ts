import { expect, test } from "@playwright/test";
import { openExample } from "../helpers/navigation";

const examples = [
	{ name: "playground", title: /playground/i },
	{ name: "esm-bundler", title: /esm/i },
	{ name: "react", title: /react/i },
	{ name: "self-hosted", title: /self.hosted/i },
	{ name: "streaming", title: /stream/i },
];

for (const { name, title } of examples) {
	test.describe(`${name} example`, () => {
		test("page loads without errors", async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));

			await openExample(page, name);
			await expect(page).toHaveTitle(title);
			expect(errors).toEqual([]);
		});
	});
}
