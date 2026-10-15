import { BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial } from "three";
import { BASE_PALETTE, hexToRgb } from "./palettes";

// [x, y, z, w, h, d, color]: centered on x and z, standing on y, colored by a BASE_PALETTE index.
export type Voxel = readonly [x: number, y: number, z: number, w: number, h: number, d: number, color: number];

const PALETTE_RGB = BASE_PALETTE.map(hexToRgb);

// Each face: normal, then four corners as unit offsets (counter-clockwise seen from outside).
const FACES: readonly { normal: [number, number, number]; corners: [number, number, number][] }[] = [
	{
		normal: [1, 0, 0],
		corners: [
			[1, 0, 1],
			[1, 0, 0],
			[1, 1, 0],
			[1, 1, 1],
		],
	},
	{
		normal: [-1, 0, 0],
		corners: [
			[0, 0, 0],
			[0, 0, 1],
			[0, 1, 1],
			[0, 1, 0],
		],
	},
	{
		normal: [0, 1, 0],
		corners: [
			[0, 1, 1],
			[1, 1, 1],
			[1, 1, 0],
			[0, 1, 0],
		],
	},
	{
		normal: [0, -1, 0],
		corners: [
			[0, 0, 0],
			[1, 0, 0],
			[1, 0, 1],
			[0, 0, 1],
		],
	},
	{
		normal: [0, 0, 1],
		corners: [
			[0, 0, 1],
			[1, 0, 1],
			[1, 1, 1],
			[0, 1, 1],
		],
	},
	{
		normal: [0, 0, -1],
		corners: [
			[1, 0, 0],
			[0, 0, 0],
			[0, 1, 0],
			[1, 1, 0],
		],
	},
];

export function buildVoxelGeometry(boxes: readonly Voxel[]): BufferGeometry {
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	for (const [x, y, z, w, h, d, color] of boxes) {
		const [r, g, b] = PALETTE_RGB[color] ?? PALETTE_RGB[0];
		const origin = [x - w / 2, y, z - d / 2];
		for (const face of FACES) {
			const start = positions.length / 3;
			for (const [cx, cy, cz] of face.corners) {
				positions.push(origin[0] + cx * w, origin[1] + cy * h, origin[2] + cz * d);
				normals.push(...face.normal);
				colors.push(r, g, b);
			}
			indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
	geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
	geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
	geometry.setIndex(indices);
	return geometry;
}

const voxelMaterial = new MeshLambertMaterial({ vertexColors: true });

export function buildVoxelMesh(boxes: readonly Voxel[]): Mesh {
	return new Mesh(buildVoxelGeometry(boxes), voxelMaterial);
}
