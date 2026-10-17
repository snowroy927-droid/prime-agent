import type { TierId } from "../../shared/combo";

export const BASE_PALETTE: readonly string[] = [
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
];

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
	return [
		Number.parseInt(hex.slice(1, 3), 16) / 255,
		Number.parseInt(hex.slice(3, 5), 16) / 255,
		Number.parseInt(hex.slice(5, 7), 16) / 255,
	];
}

const BASE_RGB = BASE_PALETTE.map(hexToRgb);

const TINTS: Record<Exclude<TierId, "fever">, { tint: Rgb; mix: number; desaturate: number }> = {
	terminal: { tint: hexToRgb("#3fd16b"), mix: 0, desaturate: 0 },
	ice: { tint: hexToRgb("#39c6e0"), mix: 0.25, desaturate: 0 },
	neon: { tint: hexToRgb("#ff5fa2"), mix: 0.25, desaturate: 0 },
	gold: { tint: hexToRgb("#f2c94c"), mix: 0.3, desaturate: 0 },
	cold: { tint: hexToRgb("#4a6fa5"), mix: 0.35, desaturate: 0.6 },
};

const FEVER_STEP_MS = 500;

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
	const k = (n: number) => (n + hue / 30) % 12;
	const a = saturation * Math.min(lightness, 1 - lightness);
	const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [f(0), f(8), f(4)];
}

// Every color mixes toward the tier tint; color 0 (the outline black) never changes.
export function paletteFor(tier: TierId, timeMs: number, reducedMotion: boolean): Float32Array {
	let tint: Rgb;
	let mix: number;
	let desaturate = 0;
	if (tier === "fever") {
		mix = 0.3;
		// Two palette changes per second at most, under the WCAG 2.3.1 flash threshold.
		tint = reducedMotion ? hexToRgb("#f2c94c") : hslToRgb((Math.floor(timeMs / FEVER_STEP_MS) % 6) * 60, 0.9, 0.6);
	} else {
		({ tint, mix, desaturate } = TINTS[tier]);
	}
	const out = new Float32Array(48);
	BASE_RGB.forEach((color, i) => {
		let [r, g, b] = color;
		if (i !== 0) {
			r += (tint[0] - r) * mix;
			g += (tint[1] - g) * mix;
			b += (tint[2] - b) * mix;
			if (desaturate > 0) {
				const luma = 0.3 * r + 0.59 * g + 0.11 * b;
				r += (luma - r) * desaturate;
				g += (luma - g) * desaturate;
				b += (luma - b) * desaturate;
			}
		}
		out[i * 3] = Math.min(1, Math.max(0, r));
		out[i * 3 + 1] = Math.min(1, Math.max(0, g));
		out[i * 3 + 2] = Math.min(1, Math.max(0, b));
	});
	return out;
}

const HUD_ACCENTS: Record<TierId, string> = {
	terminal: "#3fd16b",
	ice: "#39c6e0",
	neon: "#ff5fa2",
	gold: "#f2c94c",
	fever: "#ff7ad1",
	cold: "#7d9cc9",
};

export function hudColors(tier: TierId): { bg: string; panel: string; text: string; accent: string; danger: string } {
	return { bg: "#07080f", panel: "#0d1122", text: "#e3e9f7", accent: HUD_ACCENTS[tier], danger: "#ff5a5a" };
}
