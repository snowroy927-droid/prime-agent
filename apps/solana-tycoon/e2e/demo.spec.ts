import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = "test-results/screenshots";

declare global {
	interface Window {
		__tiers: string[];
	}
}

// Records every tier the page passes through, so a short-lived tier is not missed between polls.
async function watchTiers(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.__tiers = [];
		new MutationObserver(() => {
			const tier = document.documentElement.dataset.tier;
			if (tier && window.__tiers[window.__tiers.length - 1] !== tier) window.__tiers.push(tier);
			// The init script runs before <html> exists, so watch the document subtree.
		}).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-tier"] });
	});
}

function inOrder(seen: readonly string[], wanted: readonly string[]): boolean {
	let next = 0;
	for (const tier of seen) if (tier === wanted[next]) next += 1;
	return next === wanted.length;
}

async function pixelVariance(page: Page, png: Buffer): Promise<number> {
	return page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas unavailable");
		ctx.drawImage(image, 0, 0);
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let sum = 0;
		let sumSq = 0;
		const n = data.length / 4;
		for (let i = 0; i < data.length; i += 4) {
			const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			sum += luma;
			sumSq += luma * luma;
		}
		const mean = sum / n;
		return sumSq / n - mean * mean;
	}, png.toString("base64"));
}

test.describe.configure({ mode: "serial" });

test("the combo tiers run ice, then fever, then cold", async ({ page }) => {
	await watchTiers(page);
	await page.goto("/");
	await expect(page.locator(".badge").first()).toHaveText("SYNTHETIC DEMO");
	await expect
		.poll(() => page.evaluate(() => window.__tiers), { timeout: 150_000, intervals: [1_000] })
		.toEqual(expect.arrayContaining(["ice", "fever", "cold"]));
	const seen = await page.evaluate(() => window.__tiers);
	expect(inOrder(seen, ["ice", "fever", "cold"]), `tiers seen: ${seen.join(" > ")}`).toBe(true);
});

test("the demo shows the badge, a rendered office, and a rejected rug", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator(".badge").first()).toHaveText("SYNTHETIC DEMO");
	const rug = page.locator("#radar li.row").filter({ hasText: 'Name contains "rug"' });
	await expect(rug.first()).toBeVisible({ timeout: 60_000 });
	await expect(rug.first().locator(".verdict")).toHaveText("REJECTED");

	const canvas = page.locator(".scene-canvas");
	await expect(canvas).toBeVisible();
	await page.waitForTimeout(1_500);
	expect(await pixelVariance(page, await canvas.screenshot())).toBeGreaterThan(0);
});

test("screenshots at desktop and phone sizes", async ({ page }) => {
	mkdirSync(SHOTS, { recursive: true });
	for (const [name, width, height] of [
		["desktop", 1440, 900],
		["phone", 390, 844],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/");
		await expect(page.locator(".badge").first()).toHaveText("SYNTHETIC DEMO");
		await page.waitForTimeout(2_000);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
		expect(overflow, `${name} scrolls sideways`).toBe(false);
		await page.screenshot({ path: `${SHOTS}/${name}-${width}x${height}.png` });
	}
});

test.describe("reduced motion", () => {
	test.use({ reducedMotion: "reduce" });

	test("follows the system setting", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
	});
});
