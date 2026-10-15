import {
	CanvasTexture,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	NearestFilter,
	PlaneGeometry,
	Vector3,
} from "three";
import type { UpgradeId } from "../../shared/progression";
import { BASE_PALETTE } from "./palettes";
import { buildVoxelMesh, type Voxel } from "./voxel";

export type CastId = "zorp" | "vera" | "rex" | "gloop" | "ceo";
export type ScreenId = "scout" | "analyst" | "trader" | "cfo" | "ceo" | "wall";

export interface Office {
	root: Group;
	anchors: Record<CastId, Vector3>;
	screens: Record<ScreenId, Mesh<PlaneGeometry, MeshBasicMaterial>>;
	intern: { group: Group; anchor: Vector3 };
	setUpgrades(ids: readonly UpgradeId[]): void;
}

// Desks sit in one screen-horizontal row: d moves along the row, row moves toward the camera.
const ROW = -3;
const along = (d: number, row = ROW) => ({ x: (row + d) / 2, z: (row - d) / 2 });

const STATIONS: Record<CastId, { x: number; z: number; screen: ScreenId }> = {
	zorp: { ...along(-12), screen: "scout" },
	vera: { ...along(-6), screen: "analyst" },
	rex: { ...along(0), screen: "trader" },
	gloop: { ...along(6), screen: "cfo" },
	ceo: { ...along(3, 6), screen: "ceo" },
};

// Characters stand behind their desk, offset in the desk's rotated frame.
function standBehind(x: number, z: number, lateral: number, back: number): Vector3 {
	return new Vector3(x + (lateral + back) * Math.SQRT1_2, 0, z + (back - lateral) * Math.SQRT1_2);
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (ctx) draw(ctx);
	const texture = new CanvasTexture(canvas);
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	return texture;
}

function plane(width: number, height: number, material: MeshBasicMaterial): Mesh<PlaneGeometry, MeshBasicMaterial> {
	return new Mesh(new PlaneGeometry(width, height), material);
}

// Fixed star field so the windows look the same on every load.
const STARS = Array.from({ length: 30 }, (_, i) => [((i * 37) % 97) / 97, ((i * 53) % 89) / 89, (i * 17) % 10]);

function drawStars(ctx: CanvasRenderingContext2D, width: number, height: number, planet: boolean): void {
	ctx.fillStyle = BASE_PALETTE[0];
	ctx.fillRect(0, 0, width, height);
	for (const [a, b, brightness] of STARS) {
		ctx.fillStyle = brightness > 6 ? BASE_PALETTE[5] : BASE_PALETTE[3];
		ctx.fillRect(Math.floor(a * width), Math.floor(b * height), 1, 1);
	}
	if (!planet) return;
	ctx.fillStyle = BASE_PALETTE[11];
	ctx.beginPath();
	ctx.arc(width * 0.68, height * 0.62, 11, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = BASE_PALETTE[13];
	ctx.fillRect(width * 0.68 - 18, height * 0.62, 36, 2);
}

function desk(big: boolean): Voxel[] {
	return [
		[0, 0, 0, big ? 3.8 : 2.8, 1.3, 1.6, big ? 6 : 7],
		[0, 1.3, 0, big ? 4 : 3, 0.2, 1.8, big ? 13 : 6],
		[-0.55, 1.5, -0.3, 1.6, 1.25, 1.1, 3],
		...(big ? ([[1.1, 1.5, 0.75, 1.3, 0.35, 0.2, 13]] as Voxel[]) : []),
	];
}

export function buildOffice(): Office {
	const root = new Group();

	const shell: Voxel[] = [];
	for (let x = -11; x < 9; x += 2) {
		for (let z = -7; z < 7; z += 2) shell.push([x + 1, -0.3, z + 1, 2, 0.3, 2, ((x + z) / 2) % 2 === 0 ? 2 : 1]);
	}
	shell.push(
		[-1, 0, -7.3, 20.6, 7, 0.6, 1],
		[-11.3, 0, 0, 0.6, 7, 14, 1],
		[-1, 0, -6.95, 20.6, 0.5, 0.7, 3],
		[-10.95, 0, 0, 0.7, 0.5, 14, 3],
		[-1, 6.6, -7.2, 20.6, 0.4, 0.8, 2],
		[-11.2, 6.6, 0, 0.8, 0.4, 14, 2],
		[-3.2, 1.4, -6.85, 9, 4.9, 0.4, 0],
	);
	root.add(buildVoxelMesh(shell));

	const screens = {} as Record<ScreenId, Mesh<PlaneGeometry, MeshBasicMaterial>>;
	screens.wall = plane(8.4, 4.2, new MeshBasicMaterial());
	screens.wall.position.set(-3.2, 3.85, -6.62);
	root.add(screens.wall);

	const smallWindow = new Group();
	smallWindow.add(buildVoxelMesh([[-10.85, 2, 3.6, 0.4, 3.4, 4, 3]]));
	const starWindow = plane(
		3.5,
		2.9,
		new MeshBasicMaterial({ map: canvasTexture(48, 40, (ctx) => drawStars(ctx, 48, 40, false)) }),
	);
	starWindow.rotation.y = Math.PI / 2;
	starWindow.position.set(-10.6, 3.7, 3.6);
	smallWindow.add(starWindow);
	root.add(smallWindow);

	const anchors = {} as Record<CastId, Vector3>;
	for (const [id, station] of Object.entries(STATIONS) as [CastId, (typeof STATIONS)[CastId]][]) {
		const group = new Group();
		group.position.set(station.x, 0, station.z);
		group.rotation.y = Math.PI / 4;
		const big = id === "ceo";
		group.add(buildVoxelMesh(desk(big)));
		const screen = plane(1.36, 1, new MeshBasicMaterial());
		screen.position.set(-0.55, 2.13, 0.26);
		group.add(screen);
		screens[station.screen] = screen;
		root.add(group);
		anchors[id] = standBehind(station.x, station.z, big ? 1.2 : 0.85, 1.55);
	}

	const props = {} as Record<UpgradeId, Group>;
	const addProp = (id: UpgradeId, build: (group: Group) => void) => {
		const group = new Group();
		build(group);
		group.visible = false;
		root.add(group);
		props[id] = group;
	};

	addProp("neon_sign", (group) => {
		const texture = canvasTexture(64, 16, (ctx) => {
			ctx.fillStyle = BASE_PALETTE[15];
			ctx.font = '8px "Press Start 2P", monospace';
			ctx.textBaseline = "top";
			ctx.fillText("SUPER C", 4, 4);
		});
		const sign = plane(4.6, 1.15, new MeshBasicMaterial({ map: texture, transparent: true }));
		sign.rotation.y = Math.PI / 2;
		sign.position.set(-10.55, 4.6, -1.2);
		group.add(sign);
	});
	addProp("plants_coffee", (group) => {
		const boxes: Voxel[] = [];
		for (const [x, z] of [
			[-10.2, -6.2],
			[8.2, -6.2],
			[-10.2, 6.2],
		]) {
			boxes.push([x, 0, z, 0.9, 0.9, 0.9, 6], [x, 0.9, z, 1.3, 1.3, 1.3, 10], [x, 2.1, z, 0.8, 0.8, 0.8, 10]);
		}
		boxes.push(
			[2.6, 0, -6.4, 1.2, 2, 0.9, 3],
			[2.6, 1.2, -5.9, 1, 0.55, 0.2, 12],
			[2.6, 0.55, -5.85, 0.35, 0.35, 0.35, 5],
		);
		group.add(buildVoxelMesh(boxes));
	});
	const internSpot = along(-2, 7);
	const internAnchor = standBehind(internSpot.x, internSpot.z, 0.7, 1.4);
	addProp("second_row", (group) => {
		const deskGroup = new Group();
		deskGroup.position.set(internSpot.x, 0, internSpot.z);
		deskGroup.rotation.y = Math.PI / 4;
		deskGroup.add(
			buildVoxelMesh([
				[0, 0, 0, 2.6, 1.2, 1.5, 7],
				[0, 1.2, 0, 2.8, 0.2, 1.7, 6],
				[-0.5, 1.4, -0.3, 1.2, 0.9, 0.9, 3],
			]),
		);
		group.add(deskGroup);
	});
	addProp("trophy_wall", (group) => {
		const boxes: Voxel[] = [[-10.6, 2.6, -4.6, 0.8, 0.3, 3.6, 7]];
		for (const z of [-6, -5, -4, -3.2]) {
			boxes.push(
				[-10.6, 2.9, z, 0.45, 0.35, 0.45, 13],
				[-10.6, 3.25, z, 0.22, 0.35, 0.22, 13],
				[-10.6, 3.6, z, 0.7, 0.45, 0.55, 13],
			);
		}
		group.add(buildVoxelMesh(boxes));
	});
	addProp("space_window", (group) => {
		group.add(buildVoxelMesh([[-10.75, 1.4, 3.6, 0.4, 4.6, 6.4, 2]]));
		const view = plane(
			5.9,
			4.1,
			new MeshBasicMaterial({ map: canvasTexture(64, 48, (ctx) => drawStars(ctx, 64, 48, true)) }),
		);
		view.rotation.y = Math.PI / 2;
		view.position.set(-10.5, 3.7, 3.6);
		group.add(view);
	});
	addProp("gold_vault", (group) => {
		const door = new Mesh(
			new CylinderGeometry(1.9, 1.9, 0.5, 12),
			new MeshLambertMaterial({ color: BASE_PALETTE[13] }),
		);
		door.rotation.x = Math.PI / 2;
		door.position.set(5.2, 2.3, -6.75);
		group.add(door);
		group.add(
			buildVoxelMesh([
				[5.2, 1.2, -6.4, 0.45, 2.2, 0.3, 7],
				[5.2, 2.08, -6.4, 2.2, 0.45, 0.3, 7],
			]),
		);
	});

	return {
		root,
		anchors,
		screens,
		intern: { group: props.second_row, anchor: internAnchor },
		setUpgrades(ids) {
			const unlocked = new Set(ids);
			for (const id of Object.keys(props) as UpgradeId[]) props[id].visible = unlocked.has(id);
			smallWindow.visible = !unlocked.has("space_window");
		},
	};
}
