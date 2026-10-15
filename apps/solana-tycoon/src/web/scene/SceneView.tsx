import { useEffect, useRef, useState } from "react";
import { AmbientLight, Color, DirectionalLight, type Mesh, OrthographicCamera, Scene, Vector3 } from "three";
import type { GameStore } from "../state/useGame";
import { MonitorTextures } from "./monitors";
import { buildOffice, type ScreenId } from "./office";
import { BASE_PALETTE } from "./palettes";
import { PixelRenderer } from "./renderer";

const CAMERA_TARGET = new Vector3(-1.4, 1.7, 0.2);
// Isometric-style view from the room's open corner.
const CAMERA_DIRECTION = new Vector3(1, 0.86, 1).normalize();

function fitCamera(camera: OrthographicCamera, aspect: number): void {
	const viewWidth = Math.max(14.5 * aspect, 25);
	const viewHeight = viewWidth / aspect;
	camera.left = -viewWidth / 2;
	camera.right = viewWidth / 2;
	camera.top = viewHeight / 2;
	camera.bottom = -viewHeight / 2;
	camera.updateProjectionMatrix();
}

interface Props {
	store: GameStore;
	reducedMotion: boolean;
}

export function SceneView({ store, reducedMotion }: Props) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const reducedRef = useRef(reducedMotion);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		reducedRef.current = reducedMotion;
	}, [reducedMotion]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let renderer: PixelRenderer;
		try {
			renderer = new PixelRenderer(canvas);
		} catch (error) {
			setFailure(error instanceof Error ? error.message : "WebGL is unavailable");
			return;
		}

		const scene = new Scene();
		scene.background = new Color(BASE_PALETTE[0]);
		scene.add(new AmbientLight(0xffffff, 1.75));
		const sun = new DirectionalLight(0xffffff, 2.5);
		sun.position.set(7, 14, 10);
		scene.add(sun);

		const office = buildOffice();
		scene.add(office.root);
		const monitors = new MonitorTextures();
		for (const id of Object.keys(office.screens) as ScreenId[]) {
			const material = office.screens[id].material;
			material.map = monitors.textures[id];
			material.needsUpdate = true;
		}

		const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
		camera.position.copy(CAMERA_TARGET).addScaledVector(CAMERA_DIRECTION, 80);
		camera.lookAt(CAMERA_TARGET);

		const resize = () => {
			renderer.resize();
			fitCamera(camera, renderer.aspect());
		};
		resize();
		const observer = new ResizeObserver(resize);
		if (canvas.parentElement) observer.observe(canvas.parentElement);

		let frame = 0;
		const draw = (now: number) => {
			frame = requestAnimationFrame(draw);
			if (document.hidden) return;
			const state = store.getState();
			renderer.setTier(state.tier);
			renderer.setReducedMotion(reducedRef.current);
			office.setUpgrades(state.upgrades);
			monitors.update(state, now);
			renderer.render(scene, camera, now);
		};
		frame = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			monitors.dispose();
			scene.traverse((object) => {
				const mesh = object as Mesh;
				if (mesh.geometry) mesh.geometry.dispose();
			});
			renderer.dispose();
		};
	}, [store]);

	return (
		<>
			<canvas
				ref={canvasRef}
				className="scene-canvas"
				role="img"
				aria-label="Pixel office where the crew reacts to trades"
			/>
			{failure ? <div className="scene-fallback">3D view unavailable: {failure}. The HUD keeps working.</div> : null}
		</>
	);
}
