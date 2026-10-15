import {
	type Camera,
	ColorManagement,
	LinearSRGBColorSpace,
	Mesh,
	NearestFilter,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	WebGLRenderer,
	WebGLRenderTarget,
} from "three";
import type { TierId } from "../../shared/combo";
import { paletteFor } from "./palettes";
import { POST_FRAGMENT, POST_VERTEX } from "./shaders";

const LOW_HEIGHT = 180;
const CHROMA_PX: Record<TierId, number> = { terminal: 0, ice: 0.5, neon: 1, gold: 1.5, fever: 2.5, cold: 0 };

// Palette indices are raw sRGB values; color management would convert them away from the palette.
ColorManagement.enabled = false;

// Renders a scene at 180 lines, then quantizes and CRT-filters it up to the canvas.
export class PixelRenderer {
	private readonly gl: WebGLRenderer;
	private readonly target: WebGLRenderTarget;
	private readonly post: ShaderMaterial;
	private readonly postScene = new Scene();
	private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private tier: TierId = "terminal";
	private shakePx = 0;
	private reducedMotion = false;
	private lowWidth = 320;

	constructor(private readonly canvas: HTMLCanvasElement) {
		this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
		this.gl.outputColorSpace = LinearSRGBColorSpace;
		this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.target = new WebGLRenderTarget(this.lowWidth, LOW_HEIGHT, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
		});
		this.post = new ShaderMaterial({
			uniforms: {
				tDiffuse: { value: this.target.texture },
				uBase: { value: paletteFor("terminal", 0, false) },
				uPal: { value: paletteFor("terminal", 0, false) },
				uLow: { value: new Vector2(this.lowWidth, LOW_HEIGHT) },
				uChroma: { value: 0 },
				uShake: { value: new Vector2() },
				uCurve: { value: 0.08 },
			},
			vertexShader: POST_VERTEX,
			fragmentShader: POST_FRAGMENT,
		});
		this.postScene.add(new Mesh(new PlaneGeometry(2, 2), this.post));
	}

	setTier(tier: TierId): void {
		this.tier = tier;
	}

	setShake(px: number): void {
		this.shakePx = px;
	}

	setReducedMotion(on: boolean): void {
		this.reducedMotion = on;
	}

	aspect(): number {
		return this.lowWidth / LOW_HEIGHT;
	}

	resize(): void {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		this.gl.setSize(width, height, false);
		this.lowWidth = Math.round(Math.min(420, Math.max(160, (LOW_HEIGHT * width) / height)));
		this.target.setSize(this.lowWidth, LOW_HEIGHT);
		(this.post.uniforms.uLow.value as Vector2).set(this.lowWidth, LOW_HEIGHT);
	}

	render(scene: Scene, camera: Camera, timeMs: number): void {
		const uniforms = this.post.uniforms;
		uniforms.uPal.value = paletteFor(this.tier, timeMs, this.reducedMotion);
		uniforms.uChroma.value = CHROMA_PX[this.tier];
		const shake = this.reducedMotion ? 0 : this.shakePx;
		(uniforms.uShake.value as Vector2).set(
			Math.round((Math.random() * 2 - 1) * shake),
			Math.round((Math.random() * 2 - 1) * shake),
		);
		this.gl.setRenderTarget(this.target);
		this.gl.render(scene, camera);
		this.gl.setRenderTarget(null);
		this.gl.render(this.postScene, this.postCamera);
	}

	dispose(): void {
		this.target.dispose();
		this.post.dispose();
		this.gl.dispose();
	}
}
