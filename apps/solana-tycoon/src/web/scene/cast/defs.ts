import type { CastId } from "../office";
import type { Voxel } from "../voxel";

export type { CastId };
export type PartId = "head" | "body" | "armL" | "armR" | "legL" | "legR" | "prop";

interface Colors {
	skin: number;
	body: number;
	legs: number;
	trim: number;
}

// Colors are BASE_PALETTE indexes. Voxels are relative to each part's pivot (see character.ts).
const COLORS: Record<CastId, Colors> = {
	zorp: { skin: 10, body: 1, legs: 2, trim: 14 },
	vera: { skin: 8, body: 15, legs: 1, trim: 5 },
	rex: { skin: 9, body: 1, legs: 1, trim: 5 },
	gloop: { skin: 11, body: 2, legs: 1, trim: 13 },
	ceo: { skin: 8, body: 3, legs: 1, trim: 5 },
	inky: { skin: 12, body: 14, legs: 12, trim: 13 },
};

const eye = (x: number, color = 0, w = 0.2, h = 0.26): Voxel => [x, 0.5, 0.61, w, h, 0.04, color];

function frame({ skin, body, legs }: Colors): Record<Exclude<PartId, "prop">, Voxel[]> {
	const leg: Voxel[] = [
		[0, -0.6, 0, 0.36, 0.6, 0.4, legs],
		[0, -0.6, 0.05, 0.4, 0.16, 0.5, 0],
	];
	const arm: Voxel[] = [
		[0, -0.8, 0, 0.3, 0.8, 0.32, body],
		[0, -1.0, 0, 0.28, 0.22, 0.3, skin],
	];
	return {
		head: [[0, 0, 0, 1.35, 1.2, 1.2, skin]],
		body: [[0, 0, 0, 1.05, 0.95, 0.62, body]],
		armL: [...arm],
		armR: [...arm],
		legL: [...leg],
		legR: [...leg],
	};
}

function define(id: CastId, extra: Partial<Record<PartId, Voxel[]>>): Record<PartId, Voxel[]> {
	const base = frame(COLORS[id]);
	return {
		head: [...base.head, ...(extra.head ?? [])],
		body: [...base.body, ...(extra.body ?? [])],
		armL: base.armL,
		armR: [...base.armR, ...(extra.armR ?? [])],
		legL: extra.legL ?? base.legL,
		legR: extra.legR ?? base.legR,
		prop: extra.prop ?? [],
	};
}

// Three short tentacles per leg pivot, each curling forward at the tip.
const tentacles = (color: number): Voxel[] =>
	[-0.17, 0, 0.17].flatMap((x): Voxel[] => [
		[x, -0.48, 0, 0.15, 0.48, 0.15, color],
		[x, -0.6, 0.08, 0.15, 0.12, 0.3, color],
	]);

export const CAST_DEFS: Record<CastId, { parts: Record<PartId, Voxel[]> }> = {
	// Alien scout: big eyes, antenna (its tip is the prop, recolored by state), headset.
	zorp: {
		parts: define("zorp", {
			head: [
				eye(-0.3, 0, 0.32, 0.34),
				eye(0.3, 0, 0.32, 0.34),
				eye(-0.24, 5, 0.08, 0.08),
				eye(0.36, 5, 0.08, 0.08),
				[0, 1.2, 0, 0.08, 0.6, 0.08, 4],
				[0, 1.15, 0, 1.5, 0.14, 0.3, 1],
				[-0.75, 0.45, 0, 0.2, 0.4, 0.4, 1],
				[-0.62, 0.3, 0.45, 0.1, 0.1, 0.5, 14],
			],
			body: [[0, 0.8, 0, 1.08, 0.14, 0.64, COLORS.zorp.trim]],
			prop: [[0, 1.75, 0, 0.24, 0.24, 0.24, 10]],
		}),
	},
	// Analyst: bob haircut, glasses, clipboard in the right hand.
	vera: {
		parts: define("vera", {
			head: [
				eye(-0.3),
				eye(0.3),
				[0, 0.95, -0.02, 1.5, 0.45, 1.36, 6],
				[-0.73, 0.25, -0.02, 0.2, 1.0, 1.3, 6],
				[0.73, 0.25, -0.02, 0.2, 1.0, 1.3, 6],
				[0, 0.2, -0.65, 1.4, 1.1, 0.2, 6],
				[-0.3, 0.75, 0.63, 0.46, 0.06, 0.04, 0],
				[0.3, 0.75, 0.63, 0.46, 0.06, 0.04, 0],
				[0, 0.62, 0.63, 0.16, 0.05, 0.04, 0],
			],
			body: [[0, 0.35, 0.33, 0.32, 0.6, 0.04, 5]],
			prop: [
				[0.1, -1.1, 0.3, 0.6, 0.75, 0.08, 7],
				[0.1, -1.0, 0.36, 0.48, 0.55, 0.04, 5],
			],
		}),
	},
	// Trader: slicked hair, sunglasses, pinstripe suit, red tie.
	rex: {
		parts: define("rex", {
			head: [
				[0, 0.5, 0.63, 1.15, 0.24, 0.04, 0],
				[0, 1.0, -0.05, 1.45, 0.3, 1.3, 0],
				[0, 0.6, -0.6, 1.45, 0.5, 0.25, 0],
			],
			body: [
				[0, 0.29, 0.33, 0.34, 0.66, 0.04, 5],
				[0, 0.3, 0.35, 0.14, 0.58, 0.05, 12],
				...[-0.4, -0.25, 0.25, 0.4].map((x): Voxel => [x, 0.02, 0.33, 0.03, 0.9, 0.04, 4]),
			],
		}),
	},
	// Alien CFO: three eyes, gold monocle, head bumps, gold tie.
	gloop: {
		parts: define("gloop", {
			head: [
				eye(-0.4, 5, 0.26, 0.26),
				eye(0, 5, 0.26, 0.26),
				eye(0.4, 5, 0.26, 0.26),
				[-0.4, 0.58, 0.64, 0.11, 0.11, 0.05, 0],
				[0, 0.58, 0.64, 0.11, 0.11, 0.05, 0],
				[0.4, 0.58, 0.64, 0.11, 0.11, 0.05, 0],
				[0.4, 0.8, 0.65, 0.36, 0.06, 0.06, 13],
				[0.4, 0.42, 0.65, 0.36, 0.06, 0.06, 13],
				[0.25, 0.44, 0.65, 0.06, 0.36, 0.06, 13],
				[0.56, 0.44, 0.65, 0.06, 0.36, 0.06, 13],
				[-0.35, 1.2, 0, 0.5, 0.3, 0.5, 11],
				[0.4, 1.2, 0.1, 0.4, 0.25, 0.4, 11],
			],
			body: [
				[0, 0.32, 0.33, 0.3, 0.62, 0.04, 5],
				[0, 0.32, 0.35, 0.14, 0.56, 0.05, 13],
			],
		}),
	},
	// The owner: suit and gold tie; the desk carries the nameplate.
	ceo: {
		parts: define("ceo", {
			head: [
				eye(-0.3),
				eye(0.3),
				[0, 1.0, -0.03, 1.45, 0.4, 1.3, 7],
				[0, 0.45, -0.62, 1.4, 0.8, 0.2, 7],
				[0, 0.18, 0.63, 0.4, 0.06, 0.04, 0],
			],
			body: [
				[0, 0.29, 0.33, 0.34, 0.66, 0.04, 5],
				[0, 0.3, 0.35, 0.14, 0.58, 0.05, 13],
			],
		}),
	},
	// Squid-alien Kraken trader: dome head, two big eyes, six tentacle legs, and a headset (the prop).
	inky: {
		parts: define("inky", {
			head: [
				[0, 1.2, 0, 1.15, 0.35, 1.05, COLORS.inky.skin],
				[0, 1.55, 0, 0.75, 0.25, 0.65, COLORS.inky.skin],
				eye(-0.3, 5, 0.4, 0.44),
				eye(0.3, 5, 0.4, 0.44),
				eye(-0.24, 0, 0.18, 0.22),
				eye(0.36, 0, 0.18, 0.22),
				[-0.4, 1.3, 0.5, 0.14, 0.14, 0.06, 13],
				[0.4, 1.3, 0.5, 0.14, 0.14, 0.06, 13],
			],
			body: [[0, 0.8, 0, 1.08, 0.14, 0.64, COLORS.inky.trim]],
			legL: tentacles(COLORS.inky.legs),
			legR: tentacles(COLORS.inky.legs),
			prop: [
				[0, 1.3, 0, 1.6, 0.12, 0.28, 1],
				[-0.75, 0.4, 0, 0.2, 0.45, 0.45, 1],
				[0.75, 0.4, 0, 0.2, 0.45, 0.45, 1],
				[-0.62, 0.25, 0.45, 0.1, 0.1, 0.5, COLORS.inky.trim],
			],
		}),
	},
};
