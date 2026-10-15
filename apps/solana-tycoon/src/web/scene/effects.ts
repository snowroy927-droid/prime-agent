import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, MeshLambertMaterial, Object3D, Vector3 } from "three";
import { mulberry32 } from "../../shared/prng";
import { BASE_PALETTE } from "./palettes";

const MAX_PARTICLES = 220;
const CONFETTI_COLORS = [10, 12, 13, 14, 15, 5];
const GRAVITY = 14;

interface Particle {
	position: Vector3;
	velocity: Vector3;
	life: number;
	color: string;
	spin: number;
}

const random = mulberry32(0x5eed);
const range = (min: number, max: number) => min + random() * (max - min);

// Coin and confetti voxels plus screen shake. Reduced motion turns all of it off.
export class Effects {
	readonly mesh: InstancedMesh;
	private readonly particles: Particle[] = [];
	private readonly dummy = new Object3D();
	private readonly color = new Color();
	private shakePx = 0;
	private shakeUntil = 0;
	private motion = true;

	constructor() {
		this.mesh = new InstancedMesh(
			new BoxGeometry(0.32, 0.32, 0.32),
			new MeshLambertMaterial({ color: 0xffffff }),
			MAX_PARTICLES,
		);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		for (let i = 0; i < MAX_PARTICLES; i++) this.mesh.setColorAt(i, this.color.set(1, 1, 1));
		this.hideAll();
	}

	setMotion(on: boolean): void {
		this.motion = on;
		if (!on) {
			this.particles.length = 0;
			this.shakePx = 0;
		}
	}

	burst(kind: "coins" | "confetti", count: number, origin: Vector3): void {
		if (!this.motion) return;
		for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
			const confetti = kind === "confetti";
			this.particles.push({
				position: confetti
					? new Vector3(range(-10, 8), range(9, 12), range(-6, 6))
					: origin.clone().add(new Vector3(range(-0.6, 0.6), 3.2, range(-0.6, 0.6))),
				velocity: confetti
					? new Vector3(range(-1, 1), range(-2, 0), range(-1, 1))
					: new Vector3(range(-3, 3), range(5, 9), range(-3, 3)),
				life: confetti ? range(2.5, 4) : range(1.2, 2),
				color: confetti
					? BASE_PALETTE[CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]]
					: BASE_PALETTE[13],
				spin: range(-8, 8),
			});
		}
	}

	shake(px: number, ms: number, now: number): void {
		if (!this.motion) return;
		this.shakePx = Math.max(px, now < this.shakeUntil ? this.shakePx : 0);
		this.shakeUntil = Math.max(this.shakeUntil, now + ms);
	}

	shakeAmount(now: number): number {
		return this.motion && now < this.shakeUntil ? this.shakePx : 0;
	}

	update(dtMs: number): void {
		const seconds = dtMs / 1000;
		for (let i = this.particles.length - 1; i >= 0; i--) {
			const particle = this.particles[i];
			particle.life -= seconds;
			particle.velocity.y -= GRAVITY * seconds;
			particle.position.addScaledVector(particle.velocity, seconds);
			if (particle.position.y < 0.1) {
				particle.position.y = 0.1;
				particle.velocity.set(particle.velocity.x * 0.6, particle.velocity.y * -0.35, particle.velocity.z * 0.6);
			}
			if (particle.life <= 0) this.particles.splice(i, 1);
		}
		for (let i = 0; i < MAX_PARTICLES; i++) {
			const particle = this.particles[i];
			if (particle) {
				this.dummy.position.copy(particle.position);
				this.dummy.rotation.set(particle.life * particle.spin, particle.life * particle.spin, 0);
				this.dummy.scale.setScalar(1);
				this.mesh.setColorAt(i, this.color.set(particle.color));
			} else {
				this.dummy.position.set(0, -50, 0);
				this.dummy.scale.setScalar(0.001);
			}
			this.dummy.updateMatrix();
			this.mesh.setMatrixAt(i, this.dummy.matrix);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	private hideAll(): void {
		this.update(0);
	}
}
