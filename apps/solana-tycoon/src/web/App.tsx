import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ack, CommandInput } from "../shared/protocol";
import { Sfx } from "./audio/sfx";
import { Analytics } from "./hud/Analytics";
import { type HudActions, holdRequired } from "./hud/actions";
import { Banner } from "./hud/Banner";
import { EventLog } from "./hud/EventLog";
import { Hotbar } from "./hud/Hotbar";
import { type ActionId, actionForKey, loadKeybindings, saveKeybindings } from "./hud/keybindings";
import { Offline } from "./hud/Offline";
import { Positions } from "./hud/Positions";
import { Radar } from "./hud/Radar";
import { SettingsPanel } from "./hud/SettingsPanel";
import { TopBar } from "./hud/TopBar";
import { useHold } from "./hud/useHold";
import { reactionsFor } from "./scene/director";
import { hudColors } from "./scene/palettes";
import { SceneView } from "./scene/SceneView";
import { useGame } from "./state/useGame";

const HOTBAR_ACTIONS: ActionId[] = ["hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6"];
const HOLD_ACTIONS = new Set<ActionId>([...HOTBAR_ACTIONS, "snipeSelected", "kill"]);

function readPref(name: string, fallback: boolean): boolean {
	try {
		const value = localStorage.getItem(`super-c-sniper.${name}`);
		return value === null ? fallback : value === "true";
	} catch {
		return fallback;
	}
}

function writePref(name: string, value: boolean): void {
	try {
		localStorage.setItem(`super-c-sniper.${name}`, String(value));
	} catch {
		// Storage unavailable: the preference lasts for this page only.
	}
}

function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const list = window.matchMedia(query);
		const onChange = () => setMatches(list.matches);
		list.addEventListener("change", onChange);
		return () => list.removeEventListener("change", onChange);
	}, [query]);
	return matches;
}

function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

const token = document.querySelector<HTMLMetaElement>('meta[name="sniper-token"]')?.content ?? "";
const socketUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

export function App() {
	const game = useGame(socketUrl, token);
	const { state, store } = game;
	const hold = useHold();
	const [bindings, setBindings] = useState(() => loadKeybindings());
	const [muted, setMuted] = useState(() => readPref("muted", true));
	const [reducedPref, setReducedPref] = useState(() => readPref("reducedMotion", false));
	const systemReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const reducedMotion = reducedPref || systemReduced;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [analyticsOpen, setAnalyticsOpen] = useState(false);
	const analyticsButton = useRef<HTMLButtonElement | null>(null);
	const [tab, setTab] = useState<"radar" | "desk">("radar");
	const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
	const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
	const sfx = useMemo(() => new Sfx(), []);

	useEffect(() => sfx.setMuted(muted), [sfx, muted]);
	useEffect(
		() =>
			store.onEvent((event, next, prev) => {
				for (const reaction of reactionsFor(prev, next, event)) {
					if ("sfx" in reaction) sfx.play(reaction.sfx);
					else if ("effect" in reaction && reaction.effect === "banner") {
						const text = reaction.text;
						setBanner((current) => ({ id: (current?.id ?? 0) + 1, text }));
					}
				}
			}),
		[store, sfx],
	);
	useEffect(() => {
		if (!banner) return;
		const timer = setTimeout(() => setBanner(null), 1_700);
		return () => clearTimeout(timer);
	}, [banner]);

	useEffect(() => {
		const root = document.documentElement;
		root.dataset.tier = state.tier;
		const colors = hudColors(state.tier);
		root.style.setProperty("--accent", colors.accent);
		root.style.setProperty("--bad", colors.danger);
	}, [state.tier]);
	useEffect(() => {
		document.documentElement.dataset.reducedMotion = String(reducedMotion);
	}, [reducedMotion]);
	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 4_000);
		return () => clearTimeout(timer);
	}, [toast]);

	const openAnalytics = useCallback(() => {
		if (store.getState().snapshot) setAnalyticsOpen(true);
	}, [store]);
	const closeAnalytics = useCallback(() => {
		setAnalyticsOpen(false);
		analyticsButton.current?.focus();
	}, []);

	const notify = useCallback((text: string) => setToast((current) => ({ id: (current?.id ?? 0) + 1, text })), []);

	const run = useCallback(
		async (command: CommandInput): Promise<Ack | null> => {
			try {
				const ack = await game.send(command);
				if (!ack.ok) notify(ack.error ?? "The engine refused that");
				return ack;
			} catch (error) {
				notify(error instanceof Error ? error.message : String(error));
				return null;
			}
		},
		[game, notify],
	);

	const snapshot = state.snapshot;
	const actions: HudActions = useMemo(() => {
		const needsHold = (mint: string): boolean => holdRequired(snapshot, mint, state.now);
		return {
			snipe: (mint, holdConfirmed) => void run({ type: "snipe", mint, holdConfirmed }),
			sell: (mint, pct) => void run({ type: "sell", mint, pct }),
			pin: (mint) => void run({ type: "pin", mint }),
			unpin: (mint) => void run({ type: "unpin", mint }),
			select: (mint) => store.select(mint),
			needsHold,
		};
	}, [snapshot, state.now, run, store]);

	useEffect(() => {
		const holdOrRun = (id: string, mint: string) => {
			if (actions.needsHold(mint)) hold.start(id, () => actions.snipe(mint, true));
			else actions.snipe(mint, false);
		};
		const onDown = (event: KeyboardEvent) => {
			if (settingsOpen || analyticsOpen || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey)
				return;
			const action = actionForKey(bindings, event.key);
			if (!action) return;
			if (action === "analytics") {
				// Bound to Tab, it opens the terminal only while no control has focus, so Tab still navigates the HUD.
				if (event.key === "Tab" && (event.shiftKey || document.activeElement !== document.body)) return;
				event.preventDefault();
				openAnalytics();
				return;
			}
			event.preventDefault();
			if (event.repeat && action !== "radarUp" && action !== "radarDown") return;
			const current = store.getState();
			const pinned = current.snapshot?.pinned ?? [];
			const launches = current.snapshot?.launches ?? [];
			const hotbar = HOTBAR_ACTIONS.indexOf(action);
			if (hotbar >= 0) {
				const mint = pinned[hotbar];
				if (mint) holdOrRun(`hotbar:${mint}`, mint);
				return;
			}
			switch (action) {
				case "radarUp":
				case "radarDown": {
					if (launches.length === 0) return;
					const index = launches.findIndex((entry) => entry.launch.mint === current.selectedMint);
					const step = action === "radarUp" ? -1 : 1;
					const next = index === -1 ? 0 : Math.min(launches.length - 1, Math.max(0, index + step));
					store.select(launches[next].launch.mint);
					return;
				}
				case "snipeSelected":
					if (current.selectedMint) holdOrRun(`snipe:${current.selectedMint}`, current.selectedMint);
					return;
				case "mute":
					setMuted((value) => {
						writePref("muted", !value);
						return !value;
					});
					return;
				case "pause":
					void run({ type: current.snapshot?.risk.paused ? "resume" : "pause" });
					return;
				case "kill":
					hold.start("kill", () => void run({ type: "kill" }));
					return;
			}
		};
		const onUp = (event: KeyboardEvent) => {
			const action = actionForKey(bindings, event.key);
			if (action && HOLD_ACTIONS.has(action)) hold.cancel();
		};
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);
		return () => {
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
		};
	}, [actions, analyticsOpen, bindings, hold, openAnalytics, run, settingsOpen, store]);

	const updateBindings = useCallback((next: typeof bindings) => {
		saveKeybindings(next);
		setBindings(next);
	}, []);

	return (
		<div className="app" data-tab={tab}>
			<TopBar
				state={state}
				muted={muted}
				hold={hold}
				onPause={() => void run({ type: snapshot?.risk.paused ? "resume" : "pause" })}
				onAuto={() => void run({ type: "setSettings", patch: { autoSnipe: !snapshot?.settings.autoSnipe } })}
				onMute={() =>
					setMuted((value) => {
						writePref("muted", !value);
						return !value;
					})
				}
				onSettings={() => setSettingsOpen(true)}
				onAnalytics={openAnalytics}
				analyticsRef={analyticsButton}
				onKill={() => void run({ type: "kill" })}
			/>
			<main className="main">
				<Radar state={state} actions={actions} hold={hold} />
				<section className="center" aria-label="Office">
					<div className="scene-wrap" data-scene="true">
						<SceneView store={store} reducedMotion={reducedMotion} onOpenAnalytics={openAnalytics} />
						<Banner banner={banner} tier={state.tier} />
						<Offline connection={state.connection} retryAt={() => game.client.retryAt()} />
					</div>
					<div className="tabs" role="tablist" aria-label="Panels">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "radar"}
							className={`btn ${tab === "radar" ? "on" : ""}`}
							onClick={() => setTab("radar")}
						>
							RADAR
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "desk"}
							className={`btn ${tab === "desk" ? "on" : ""}`}
							onClick={() => setTab("desk")}
						>
							DESK
						</button>
					</div>
					<Hotbar state={state} actions={actions} hold={hold} bindings={bindings} />
					<EventLog lines={state.log} />
				</section>
				<Positions state={state} actions={actions} />
			</main>
			{toast ? (
				<div key={toast.id} className="toast" role="alert">
					{toast.text}
				</div>
			) : null}
			{analyticsOpen && snapshot ? <Analytics state={state} onClose={closeAnalytics} /> : null}
			{settingsOpen && snapshot ? (
				<SettingsPanel
					settings={snapshot.settings}
					bindings={bindings}
					reducedMotion={reducedPref}
					onSave={async (patch) => {
						const ack = await run({ type: "setSettings", patch });
						return ack?.ok ? null : (ack?.error ?? "Engine offline");
					}}
					onBindings={updateBindings}
					onReducedMotion={(value) => {
						writePref("reducedMotion", value);
						setReducedPref(value);
					}}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
		</div>
	);
}
