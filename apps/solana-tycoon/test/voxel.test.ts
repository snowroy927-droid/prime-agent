import type { BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { CAST_DEFS } from "../src/web/scene/cast/defs";
import { BASE_PALETTE } from "../src/web/scene/palettes";
import { buildVoxelMesh } from "../src/web/scene/voxel";

describe("buildVoxelMesh", () => {
	it("merges boxes into one indexed geometry with palette vertex colors", () => {
		const mesh = buildVoxelMesh([
			[0, 0, 0, 1, 1, 1, 10],
			[2, 0, 0, 1, 2, 1, 12],
			[0, 1, 2, 2, 1, 1, 5],
		]);
		const geometry = mesh.geometry;
		expect(geometry.getAttribute("position").count).toBe(72);
		expect(geometry.getIndex()?.count).toBe(108);
		expect(geometry.getAttribute("normal").count).toBe(72);
		const colors = geometry.getAttribute("color") as BufferAttribute;
		expect(colors.getX(0)).toBeCloseTo(0x3f / 255, 5);
		expect(colors.getY(0)).toBeCloseTo(0xd1 / 255, 5);
		expect(colors.getX(24)).toBeCloseTo(0xe0 / 255, 5);
	});

	it("puts a box's base on y and centers it on x and z", () => {
		const mesh = buildVoxelMesh([[4, 1, -2, 2, 3, 4, 0]]);
		mesh.geometry.computeBoundingBox();
		const box = mesh.geometry.boundingBox;
		expect(box?.min.toArray()).toEqual([3, 1, -4]);
		expect(box?.max.toArray()).toEqual([5, 4, 0]);
	});
});

describe("INKY", () => {
	const parts = CAST_DEFS.inky.parts;

	it("has non-empty parts drawn only in palette colors", () => {
		for (const voxels of Object.values(parts)) expect(voxels.length).toBeGreaterThan(0);
		const colors = Object.values(parts).flatMap((voxels) => voxels.map((voxel) => voxel[6]));
		for (const color of colors) {
			expect(Number.isInteger(color)).toBe(true);
			expect(color).toBeGreaterThanOrEqual(0);
			expect(color).toBeLessThan(BASE_PALETTE.length);
		}
	});

	it("stands on six tentacles and has a skin color no other cast member uses", () => {
		const stalks = [...parts.legL, ...parts.legR].filter((voxel) => voxel[4] > 0.3);
		expect(stalks).toHaveLength(6);
		const skin = parts.head[0][6];
		for (const id of ["zorp", "vera", "rex", "gloop", "ceo"] as const) {
			expect(CAST_DEFS[id].parts.head[0][6]).not.toBe(skin);
			expect(CAST_DEFS[id].parts.body[0][6]).not.toBe(skin);
		}
	});
});
