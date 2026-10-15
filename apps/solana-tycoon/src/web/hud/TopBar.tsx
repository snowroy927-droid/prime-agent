import type { Ref } from "react";
import {
	activeDesk,
	type DeskId,
	type GameState,
	krakenSessionUsdMicros,
	screenTier,
	sessionLamports,
} from "../state/store";
import { DeskSwitch } from "./DeskSwitch";
import { age, clockTime, solAmount, solSigned, usdAmount, usdSigned } from "./format";
import { HoldButton } from "./HoldButton";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	onDesk: (desk: DeskId) => void;
	muted: boolean;
	hold: HoldController;
	onPause: () => void;
	onAuto: () => void;
	onMute: () => void;
	onSettings: () => void;
	onAnalytics: () => void;
	analyticsRef: Ref<HTMLButtonElement>;
	onKill: () => void;
}

function Pips({ on, total, bad }: { on: number; total: number; bad?: boolean }) {
	return (
		<span className="pips" aria-hidden="true">
			{Array.from({ length: total }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative pips
				<span key={i} className={`pip ${i < on ? (bad ? "bad" : "on") : ""}`} />
			))}
		</span>
	);
}

export function TopBar({
	state,
	onDesk,
	muted,
	hold,
	onPause,
	onAuto,
	onMute,
	onSettings,
	onAnalytics,
	analyticsRef,
	onKill,
}: Props) {
	const snapshot = state.snapshot;
	const kraken = snapshot?.kraken ?? null;
	const desk = activeDesk(state);
	const onKraken = desk === "kraken" && kraken !== null;
	const badge = !snapshot ? "OFFLINE" : snapshot.synthetic ? "SYNTHETIC DEMO" : snapshot.mode.toUpperCase();
	const session = onKraken ? krakenSessionUsdMicros(state) : sessionLamports(state);
	const balance = onKraken
		? usdAmount(kraken.balanceUsdMicros)
		: snapshot
			? `${solAmount(snapshot.balanceLamports)} SOL`
			: "--";
	const stats = onKraken ? kraken.stats : snapshot?.stats;
	const risk = onKraken ? kraken.risk : snapshot?.risk;
	const tiltTotal = onKraken ? kraken.settings.tiltLosses : (snapshot?.settings.tiltLosses ?? 3);
	const autoOn = onKraken ? kraken.settings.autoBuy : (snapshot?.settings.autoSnipe ?? false);
	const tilted = risk?.tiltUntil != null && risk.tiltUntil > state.now;
	const feed = onKraken ? kraken.feed : snapshot?.feed;
	const feedText =
		onKraken && kraken.error
			? "OFFLINE"
			: !feed
				? "--"
				: feed.status === "live"
					? "LIVE"
					: feed.status === "down"
						? `DOWN${feed.reconnectAt ? ` ${age(feed.reconnectAt - state.now)}` : ""}`
						: "CONNECTING";
	const rpcText = !snapshot
		? "--"
		: snapshot.rpc.degraded
			? "DEGRADED"
			: snapshot.rpc.publicFallback
				? "PUBLIC"
				: "OK";
	const comboCount = onKraken ? state.kraken.combo : state.combo;
	const combo = screenTier(state) === "cold" ? "COLD" : `x${comboCount}`;

	return (
		<header className="topbar">
			<div className="brand">
				<span className="logo">SUPER C SNIPER</span>
				<span
					className={`badge badge-${badge === "LIVE" ? "live" : "sim"}`}
					title="Paper, replay, and demo results are simulated. No real funds move."
				>
					{badge}
				</span>
				{onKraken ? (
					<span className="badge badge-kraken" title="Kraken desk: paper fills on Kraken's public prices">
						KRAKEN
					</span>
				) : null}
				<DeskSwitch desk={desk} krakenAvailable={kraken !== null} onSelect={onDesk} />
			</div>
			<div className="chips">
				<div className="chip" title="Paper balance: starting balance plus realized PnL minus open position cost">
					<span className="k">BALANCE</span>
					<span className="v">{balance}</span>
				</div>
				<div className="chip" title="Realized since the engine started, plus open positions at current value">
					<span className="k">SESSION</span>
					<span className={`v ${session > 0n ? "good" : session < 0n ? "bad" : ""}`}>
						{onKraken ? usdSigned(session) : solSigned(session)}
					</span>
				</div>
				<div className="chip">
					<span className="k">W/L</span>
					<span className="v">{stats ? `${stats.wins}/${stats.losses}` : "--"}</span>
				</div>
				<div className="chip">
					<span className="k">COMBO</span>
					<span className="v">{combo}</span>
					<Pips on={Math.min(comboCount, 5)} total={5} />
				</div>
				<div
					className="chip"
					title={
						tilted && risk?.tiltUntil
							? `Auto-${onKraken ? "buy" : "snipe"} paused until ${clockTime(risk.tiltUntil)}`
							: "Consecutive losses"
					}
				>
					<span className="k">TILT</span>
					<Pips on={risk?.tiltLosses ?? 0} total={tiltTotal} bad />
					{tilted && risk?.tiltUntil ? <span className="v small">{clockTime(risk.tiltUntil)}</span> : null}
				</div>
				<div
					className={`chip ${feed?.status === "down" || (onKraken && kraken.error) ? "alert" : ""}`}
					title={onKraken && kraken.error ? `Kraken offline: ${kraken.error}` : undefined}
				>
					<span className="k">FEED</span>
					<span className="v">{feedText}</span>
				</div>
				{onKraken ? null : (
					<div
						className={`chip ${snapshot?.rpc.degraded ? "alert" : ""}`}
						title="Set RPC_URL for a reliable endpoint"
					>
						<span className="k">RPC</span>
						<span className="v">{rpcText}</span>
					</div>
				)}
				<div className={`chip ${risk?.paused ? "alert" : ""}`}>
					<span className="k">ENGINE</span>
					<span className="v">
						{!snapshot
							? "--"
							: risk?.paused
								? `PAUSED${risk.pausedReason ? `: ${risk.pausedReason}` : ""}`
								: "RUNNING"}
					</span>
				</div>
			</div>
			<div className="controls">
				<button
					type="button"
					className={`btn ${autoOn ? "on" : ""}`}
					disabled={!snapshot}
					onClick={onAuto}
					aria-pressed={autoOn}
					title={onKraken ? "Auto-buy eligible Kraken movers" : "Auto-snipe approved launches"}
				>
					AUTO {autoOn ? "ON" : "OFF"}
				</button>
				<button type="button" className="btn" disabled={!snapshot} onClick={onPause}>
					{risk?.paused ? "RESUME" : "PAUSE"}
				</button>
				<button type="button" className="btn" onClick={onMute} aria-pressed={!muted}>
					{muted ? "MUTED" : "SOUND"}
				</button>
				<button ref={analyticsRef} type="button" className="btn" disabled={!snapshot} onClick={onAnalytics}>
					ANALYTICS
				</button>
				<button type="button" className="btn" onClick={onSettings}>
					SETTINGS
				</button>
				<HoldButton
					id="kill"
					hold={hold}
					needsHold
					onConfirm={onKill}
					className="btn danger"
					disabled={!snapshot}
					label="Kill switch: sell everything on both desks and pause"
				>
					KILL
				</HoldButton>
			</div>
		</header>
	);
}
