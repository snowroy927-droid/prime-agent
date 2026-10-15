import { BoxGeometry, Group, Mesh, MeshLambertMaterial, type Vector3 } from "three";
import type { CharacterState } from "../director";
import { BASE_PALETTE } from "../palettes";
import { buildVoxelMesh, type Voxel } from "../voxel";
import { CAST_DEFS, type CastId, type PartId } from "./defs";

type Limb = Exclude<PartId, "prop">;

const PIVOTS: Record<Limb, [number, number, number]> = {
	legL: [-0.24, 0.6, 0],
	legR: [0.24, 0.6, 0],
	body: [0, 0.6, 0],
	armL: [-0.68, 1.45, 0],
	armR: [0.68, 1.45, 0],
	head: [0, 1.55, 0],
};

const PROP_PARENT: Partial<Record<CastId, Limb>> = { zorp: "head", vera: "armR" };

export interface CharacterOptions {
	scale?: number;
	recolor?: Partial<Record<number, number>>;
}

function recolored(voxels: readonly Voxel[], recolor: Partial<Record<number, number>>): Voxel[] {
	return voxels.map(([x, y, z, w, h, d, color]): Voxel => [x, y, z, w, h, d, recolor[color] ?? color]);
}

// A chibi built from voxel limbs, animated by moving parts. Temporary states (ms > 0) play over
// the resting state and then fall back to it.
export class Character {
	readonly root = new Group();
	private readonly parts = {} as Record<Limb, Group>;
	private readonly tip: Mesh<BoxGeometry, MeshLambertMaterial> | null = null;
	private readonly drops: Mesh[] = [];
	private readonly home: Vector3;
	private base: CharacterState = "idle";
	private temp: { state: CharacterState; until: number } | null = null;
	private bubble: { text: string; until: number } | null = null;
	private motion = true;
	private elapsed = 0;
	private phase: number;

	constructor(
		readonly id: CastId,
		options: CharacterOptions = {},
	) {
		const recolor = options.recolor ?? {};
		const def = CAST_DEFS[id].parts;
		for (const limb of Object.keys(PIVOTS) as Limb[]) {
			const group = new Group();
			group.position.set(...PIVOTS[limb]);
			group.add(buildVoxelMesh(recolored(def[limb], recolor)));
			this.parts[limb] = group;
			this.root.add(group);
		}
		const propParent = PROP_PARENT[id];
		if (propParent && def.prop.length > 0) {
			if (id === "zorp") {
				const [x, y, z, w, h, d, color] = def.prop[0];
				this.tip = new Mesh(
					new BoxGeometry(w, h, d),
					new MeshLambertMaterial({ color: BASE_PALETTE[recolor[color] ?? color] }),
				);
				this.tip.position.set(x, y + h / 2, z);
				this.parts.head.add(this.tip);
			} else {
				this.parts[propParent].add(buildVoxelMesh(recolored(def.prop, recolor)));
			}
		}
		for (const side of [-1, 1]) {
			const drop = new Mesh(new BoxGeometry(0.16, 0.24, 0.16), new MeshLambertMaterial({ color: BASE_PALETTE[14] }));
			drop.position.set(side * 0.78, 0.9, 0.2);
			drop.visible = false;
			this.parts.head.add(drop);
			this.drops.push(drop);
		}
		this.root.scale.setScalar(options.scale ?? 1);
		this.home = this.root.position.clone();
		this.phase = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 10;
	}

	place(position: Vector3): void {
		this.home.copy(position);
		this.root.position.copy(position);
		this.root.rotation.set(0, Math.PI / 4, 0);
	}

	setState(state: CharacterState, ms = 0): void {
		if (ms > 0) this.temp = { state, until: this.elapsed + ms };
		else this.base = state;
	}

	setBubble(text: string | null, ms = 2_500): void {
		this.bubble = text === null ? null : { text, until: this.elapsed + ms };
	}

	setMotion(on: boolean): void {
		this.motion = on;
	}

	state(): CharacterState {
		return this.temp && this.elapsed < this.temp.until ? this.temp.state : this.base;
	}

	currentBubble(): { text: string; tone: "good" | "bad" | "" } | null {
		if (!this.bubble || this.elapsed >= this.bubble.until) return null;
		const state = this.state();
		const tone = state === "celebrate" ? "good" : state === "alarm" || state === "fail" ? "bad" : "";
		return { text: this.bubble.text, tone };
	}

	headPosition(target: Vector3): Vector3 {
		return this.parts.head.getWorldPosition(target);
	}

	update(dtMs: number): void {
		this.elapsed += dtMs;
		const state = this.state();
		const t = this.elapsed / 1000 + this.phase;
		const amp = this.motion ? 1 : 0.25;
		// Resting celebrate is the calm happy version; a temporary celebrate is the full jump.
		const resting = !(this.temp && this.elapsed < this.temp.until);
		const { root, parts } = this;
		root.position.copy(this.home);
		root.rotation.set(0, Math.PI / 4, 0);
		for (const limb of Object.values(parts)) limb.rotation.set(0, 0, 0);
		for (const drop of this.drops) drop.visible = false;
		if (this.tip) this.tip.material.color.set(BASE_PALETTE[state === "alarm" ? 12 : state === "sleep" ? 3 : 10]);

		switch (state) {
			case "idle":
				root.position.y += Math.abs(Math.sin(t * 2)) * 0.06 * amp;
				parts.head.rotation.y = Math.sin(t * 0.7) * 0.25 * amp;
				parts.armL.rotation.x = Math.sin(t * 2) * 0.08;
				parts.armR.rotation.x = -Math.sin(t * 2) * 0.08;
				break;
			case "work":
				parts.head.rotation.x = 0.25;
				parts.armL.rotation.x = -1.1 + Math.sin(t * 22) * 0.25 * amp;
				parts.armR.rotation.x = -1.1 - Math.sin(t * 22) * 0.25 * amp;
				root.position.y += Math.abs(Math.sin(t * 11)) * 0.03 * amp;
				break;
			case "celebrate": {
				const lift = resting ? 0.15 : 0.9;
				root.position.y += Math.abs(Math.sin(t * (resting ? 3 : 9))) * lift * amp;
				parts.armL.rotation.z = resting ? -0.6 : -2.6;
				parts.armR.rotation.z = resting ? 0.6 : 2.6;
				parts.armL.rotation.x = Math.sin(t * 18) * (resting ? 0.05 : 0.3) * amp;
				break;
			}
			case "alarm":
				root.position.x += Math.sin(t * 40) * 0.08 * amp;
				parts.armL.rotation.z = -2.2;
				parts.armR.rotation.z = 2.2;
				parts.head.rotation.z = Math.sin(t * 30) * 0.15 * amp;
				break;
			case "sleep":
				parts.head.rotation.x = 0.55;
				parts.head.rotation.z = 0.25;
				parts.armL.rotation.x = -0.3;
				parts.armR.rotation.x = -0.3;
				root.position.y -= 0.12;
				break;
			case "fail":
				parts.head.rotation.x = 0.45;
				parts.armR.rotation.x = -2.5;
				parts.armR.rotation.z = 0.5;
				parts.armL.rotation.x = 0.2;
				break;
			case "dance":
				root.rotation.y = Math.PI / 4 + (this.motion ? t * 6 : 0);
				root.position.y += Math.abs(Math.sin(t * 8)) * 0.4 * amp;
				parts.armL.rotation.z = -1.6 + Math.sin(t * 8) * 0.8 * amp;
				parts.armR.rotation.z = 1.6 + Math.sin(t * 8 + 1) * 0.8 * amp;
				parts.legL.rotation.x = Math.sin(t * 8) * 0.5 * amp;
				parts.legR.rotation.x = -Math.sin(t * 8) * 0.5 * amp;
				break;
			case "sweat":
				root.position.x += Math.sin(t * 50) * 0.03 * amp;
				parts.head.rotation.x = 0.15;
				for (const drop of this.drops) {
					drop.visible = true;
					drop.position.y = 0.9 - ((t * 2) % 1) * 0.5;
				}
				break;
		}
	}
}
