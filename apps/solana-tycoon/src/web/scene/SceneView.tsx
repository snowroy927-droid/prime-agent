import { useEffect, useRef, useState } from "react";
import {
	AmbientLight,
	Color,
	DirectionalLight,
	type Mesh,
	OrthographicCamera,
	Raycaster,
	Scene,
	Vector2,
	Vector3,
} from "three";
import { screenTier } from "../state/store";
import type { GameStore } from "../state/useGame";
import { Character } from "./cast/character";
import { ceoMood, reactionsFor } from "./director";
import { Effects } from "./effects";
import { MonitorTextures } from "./monitors";
import { buildOffice, type CastId, type ScreenId } from "./office";
import { BASE_PALETTE } from "./palettes";
import { PixelRenderer } from "./renderer";

const CAMERA_TARGET = new Vector3(-1.4, 1.7, 0.2);
// Isometric-style view from the room's open corner.
const CAMERA_DIRECTION = new Vector3(1, 0.86, 1).normalize();
const CAST_IDS: readonly CastId[] = ["zorp", "vera", "rex", "gloop", "ceo", "inky"];
const TAGS: Record<CastId, { name: string; role: string }> = {
	zorp: { name: "ZORP", role: "SCOUT" },
	vera: { name: "VERA", role: "ANALYST" },
	rex: { name: "REX", role: "TRADER" },
	gloop: { name: "GLOOP", role: "CFO" },
	ceo: { name: "YOU", role: "CEO" },
	inky: { name: "INKY", role: "KRAKEN" },
};

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
	onOpenAnalytics: () => void;
}

export function SceneView({ store, reducedMotion, onOpenAnalytics }: Props) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const reducedRef = useRef(reducedMotion);
	const openRef = useRef(onOpenAnalytics);
	const [failure, setFailure] = useState<string | null>(null);

	useEffect(() => {
		reducedRef.current = reducedMotion;
	}, [reducedMotion]);
	useEffect(() => {
		openRef.current = onOpenAnalytics;
	}, [onOpenAnalytics]);

	useEffect(() => {
		const canvas = canvasRef.current;
		const overlay = overlayRef.current;
		if (!canvas || !overlay) return;
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

		const cast = {} as Record<CastId, Character>;
		for (const id of CAST_IDS) {
			const character = new Character(id);
			character.place(office.anchors[id]);
			office.root.add(character.root);
			cast[id] = character;
		}
		const intern = new Character("zorp", { scale: 0.75, recolor: { 10: 14, 1: 2, 14: 5 } });
		intern.place(office.intern.anchor);
		intern.setState("work");
		office.intern.group.add(intern.root);

		const effects = new Effects();
		scene.add(effects.mesh);

		const labels = {} as Record<CastId, { tag: HTMLDivElement; bubble: HTMLDivElement }>;
		for (const id of CAST_IDS) {
			const tag = document.createElement("div");
			tag.className = "cast-tag";
			const role = document.createElement("span");
			role.className = "cast-role";
			role.textContent = ` ${TAGS[id].role}`;
			tag.append(TAGS[id].name, role);
			const bubble = document.createElement("div");
			bubble.className = "bubble";
			bubble.hidden = true;
			overlay.append(tag, bubble);
			labels[id] = { tag, bubble };
		}

		const offEvents = store.onEvent((event, next, prev) => {
			for (const reaction of reactionsFor(prev, next, event)) {
				if ("cast" in reaction) {
					cast[reaction.cast].setState(reaction.state, reaction.ms);
					if (reaction.bubble) cast[reaction.cast].setBubble(reaction.bubble, Math.max(reaction.ms, 2_000));
				} else if ("effect" in reaction) {
					if (reaction.effect === "coins")
						effects.burst("coins", reaction.count, office.anchors[reaction.at ?? "gloop"]);
					else if (reaction.effect === "confetti")
						effects.burst("confetti", reaction.count, office.anchors[reaction.at ?? "ceo"]);
					else if (reaction.effect === "shake") effects.shake(reaction.px, reaction.ms, performance.now());
				}
			}
		});

		const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
		camera.position.copy(CAMERA_TARGET).addScaledVector(CAMERA_DIRECTION, 80);
		camera.lookAt(CAMERA_TARGET);

		// GLOOP (the CFO) and their monitor open the analytics terminal.
		const raycaster = new Raycaster();
		const pointer = new Vector2();
		const analyticsTargets = [office.screens.cfo, cast.gloop.root];
		const overAnalytics = (event: MouseEvent): boolean => {
			const rect = canvas.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return false;
			pointer.set(
				((event.clientX - rect.left) / rect.width) * 2 - 1,
				1 - ((event.clientY - rect.top) / rect.height) * 2,
			);
			raycaster.setFromCamera(pointer, camera);
			return raycaster.intersectObjects(analyticsTargets, true).length > 0;
		};
		const onClick = (event: MouseEvent) => {
			if (overAnalytics(event)) openRef.current();
		};
		const onPointerMove = (event: PointerEvent) => {
			canvas.style.cursor = overAnalytics(event) ? "pointer" : "";
		};
		canvas.addEventListener("click", onClick);
		canvas.addEventListener("pointermove", onPointerMove);

		const resize = () => {
			renderer.resize();
			fitCamera(camera, renderer.aspect());
		};
		resize();
		const observer = new ResizeObserver(resize);
		if (canvas.parentElement) observer.observe(canvas.parentElement);

		const projected = new Vector3();
		const placeLabels = () => {
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			for (const id of CAST_IDS) {
				const character = cast[id];
				const { tag, bubble } = labels[id];
				character.root.getWorldPosition(projected).project(camera);
				tag.style.left = `${((projected.x + 1) / 2) * width}px`;
				tag.style.top = `${((1 - projected.y) / 2) * height + 4}px`;
				const said = character.currentBubble();
				if (!said) {
					bubble.hidden = true;
					continue;
				}
				character.headPosition(projected);
				projected.y += 1.9;
				projected.project(camera);
				bubble.hidden = false;
				bubble.textContent = said.text;
				bubble.className = `bubble ${said.tone}`;
				bubble.style.left = `${((projected.x + 1) / 2) * width}px`;
				bubble.style.top = `${((1 - projected.y) / 2) * height}px`;
			}
		};

		let frame = 0;
		let last = performance.now();
		const draw = (now: number) => {
			frame = requestAnimationFrame(draw);
			const dt = Math.min(100, now - last);
			last = now;
			if (document.hidden) return;
			const state = store.getState();
			const motion = !reducedRef.current;
			// Resting states follow live state so they are right after a reconnect too.
			cast.zorp.setState(state.snapshot && state.snapshot.feed.status !== "live" ? "sleep" : "idle");
			cast.rex.setState(Object.values(state.orders).some((order) => order.status === "pending") ? "work" : "idle");
			cast.gloop.setState("work");
			cast.ceo.setState(ceoMood(state));
			const kraken = state.snapshot?.kraken ?? null;
			const krakenBusy = Object.values(state.kraken.orders).some((order) => order.status === "pending");
			cast.inky.setState(
				!kraken || kraken.error || kraken.feed.status !== "live" ? "sleep" : krakenBusy ? "work" : "idle",
			);
			if (kraken?.error) cast.inky.setBubble("OFFLINE", 1_000);
			for (const character of [...Object.values(cast), intern]) {
				character.setMotion(motion);
				character.update(dt);
			}
			effects.setMotion(motion);
			effects.update(dt);
			renderer.setTier(screenTier(state));
			renderer.setReducedMotion(!motion);
			renderer.setShake(effects.shakeAmount(now));
			office.setUpgrades(state.upgrades);
			office.setTrophies(state.kraken.trophies);
			monitors.update(state, now);
			renderer.render(scene, camera, now);
			placeLabels();
		};
		frame = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(frame);
			offEvents();
			canvas.removeEventListener("click", onClick);
			canvas.removeEventListener("pointermove", onPointerMove);
			observer.disconnect();
			overlay.replaceChildren();
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
				aria-label="Pixel office where the crew reacts to trades. Click GLOOP's monitor for analytics."
			/>
			<div ref={overlayRef} className="scene-overlay" aria-hidden="true" />
			{failure ? <div className="scene-fallback">3D view unavailable: {failure}. The HUD keeps working.</div> : null}
		</>
	);
}
