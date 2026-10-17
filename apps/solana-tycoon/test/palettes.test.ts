import { describe, expect, it } from "vitest";
import type { TierId } from "../src/shared/combo";
import { BASE_PALETTE, hudColors, paletteFor } from "../src/web/scene/palettes";

const TIERS: TierId[] = ["terminal", "ice", "neon", "gold", "fever", "cold"];

function rgb(hex: string): [number, number, number] {
	return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function saturation(color: ArrayLike<number>): number {
	const [r, g, b] = [color[0], color[1], color[2]];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return max === 0 ? 0 : (max - min) / max;
}

describe("palettes", () => {
	it("defines the 16 base colors in index order", () => {
		expect(BASE_PALETTE).toEqual([
			"#0b0d17",
			"#1b2138",
			"#2e3a5c",
			"#4f5d82",
			"#8a96b8",
			"#e8ecf4",
			"#5a3a2a",
			"#9c6b43",
			"#f2c9a0",
			"#b07850",
			"#3fd16b",
			"#8e5bd6",
			"#e04848",
			"#f2c94c",
			"#39c6e0",
			"#ff5fa2",
		]);
	});

	it("returns 48 floats in [0, 1] for every tier", () => {
		for (const tier of TIERS) {
			const palette = paletteFor(tier, 1_234, false);
			expect(palette).toBeInstanceOf(Float32Array);
			expect(palette).toHaveLength(48);
			for (const value of palette) {
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(1);
			}
		}
	});

	it("leaves the terminal palette at the base colors", () => {
		const palette = paletteFor("terminal", 0, false);
		BASE_PALETTE.forEach((hex, i) => {
			const [r, g, b] = rgb(hex);
			expect(palette[i * 3]).toBeCloseTo(r, 5);
			expect(palette[i * 3 + 1]).toBeCloseTo(g, 5);
			expect(palette[i * 3 + 2]).toBeCloseTo(b, 5);
		});
	});

	it("tints toward the tier color and keeps the darkest color", () => {
		const ice = paletteFor("ice", 0, false);
		const base = rgb(BASE_PALETTE[5]);
		expect(ice[15 + 0]).toBeLessThan(base[0]);
		expect(Array.from(ice.slice(0, 3))).toEqual(Array.from(paletteFor("terminal", 0, false).slice(0, 3)));
	});

	it("desaturates the cold palette", () => {
		const cold = paletteFor("cold", 0, false);
		expect(saturation(cold.slice(30, 33))).toBeLessThan(saturation(rgb(BASE_PALETTE[10])));
	});

	it("cycles fever every 500ms unless motion is reduced", () => {
		const a = paletteFor("fever", 0, false);
		const b = paletteFor("fever", 500, false);
		expect(Array.from(a)).not.toEqual(Array.from(b));
		expect(Array.from(paletteFor("fever", 0, true))).toEqual(Array.from(paletteFor("fever", 500, true)));
		expect(Array.from(paletteFor("fever", 100, false))).toEqual(Array.from(a));
	});

	it("gives HUD colors per tier", () => {
		expect(hudColors("terminal").accent).toBe("#3fd16b");
		expect(hudColors("ice").accent).toBe("#39c6e0");
		expect(hudColors("cold")).toMatchObject({ bg: "#07080f", danger: "#ff5a5a" });
	});
});
