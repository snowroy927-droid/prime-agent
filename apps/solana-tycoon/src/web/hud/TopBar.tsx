import type { GameState } from "../state/store";
import { age, clockTime, solAmount, solSigned } from "./format";
import { HoldButton } from "./HoldButton";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	muted: boolean;
	hold: HoldController;
	onPause: () => void;
	onAuto: () => void;
	onMute: () => void;
	onSettings: () => void;
	onKill: () => void;
}

function sessionLamports(state: GameState): bigint {
	const snapshot = state.snapshot;
	if (!snapshot || state.sessionStart === null) return 0n;
	let total = 0n;
	for (const trade of snapshot.closes) if (trade.closedAt >= state.sessionStart) total += BigInt(trade.pnlLamports);
	for (const position of snapshot.positions) {
		if (position.valueLamports === null) continue;
		total += BigInt(position.valueLamports) + BigInt(position.proceedsLamports) - BigInt(position.costLamports);
	}
	return total;
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

export function TopBar({ state, muted, hold, onPause, onAuto, onMute, onSettings, onKill }: Props) {
	const snapshot = state.snapshot;
	const badge = !snapshot ? "OFFLINE" : snapshot.synthetic ? "SYNTHETIC DEMO" : snapshot.mode.toUpperCase();
	const session = sessionLamports(state);
	const risk = snapshot?.risk;
	const tilted = risk?.tiltUntil != null && risk.tiltUntil > state.now;
	const feed = snapshot?.feed;
	const feedText = !feed
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
	const combo = state.tier === "cold" ? "COLD" : `x${state.combo}`;

	return (
		<header className="topbar">
			<div className="brand">
				<span className="logo">SUPER C SNIPER</span>
				<span
					className={`badge badge-${badge === "LIVE" ? "live" : "sim"}`}
					title="Paper, replay, and demo results are simulated. No real SOL moves."
				>
					{badge}
				</span>
			</div>
			<div className="chips">
				<div className="chip" title="Paper balance: starting balance plus realized PnL minus open position cost">
					<span className="k">BALANCE</span>
					<span className="v">{snapshot ? `${solAmount(snapshot.balanceLamports)} SOL` : "--"}</span>
				</div>
				<div className="chip" title="Realized since this page connected, plus open positions at current value">
					<span className="k">SESSION</span>
					<span className={`v ${session > 0n ? "good" : session < 0n ? "bad" : ""}`}>{solSigned(session)}</span>
				</div>
				<div className="chip">
					<span className="k">W/L</span>
					<span className="v">{snapshot ? `${snapshot.stats.wins}/${snapshot.stats.losses}` : "--"}</span>
				</div>
				<div className="chip">
					<span className="k">COMBO</span>
					<span className="v">{combo}</span>
					<Pips on={Math.min(state.combo, 5)} total={5} />
				</div>
				<div
					className="chip"
					title={
						tilted && risk?.tiltUntil
							? `Auto-snipe paused until ${clockTime(risk.tiltUntil)}`
							: "Consecutive losses"
					}
				>
					<span className="k">TILT</span>
					<Pips on={risk?.tiltLosses ?? 0} total={snapshot?.settings.tiltLosses ?? 3} bad />
					{tilted && risk?.tiltUntil ? <span className="v small">{clockTime(risk.tiltUntil)}</span> : null}
				</div>
				<div className={`chip ${feed?.status === "down" ? "alert" : ""}`}>
					<span className="k">FEED</span>
					<span className="v">{feedText}</span>
				</div>
				<div
					className={`chip ${snapshot?.rpc.degraded ? "alert" : ""}`}
					title="Set RPC_URL for a reliable endpoint"
				>
					<span className="k">RPC</span>
					<span className="v">{rpcText}</span>
				</div>
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
					className={`btn ${snapshot?.settings.autoSnipe ? "on" : ""}`}
					disabled={!snapshot}
					onClick={onAuto}
					aria-pressed={snapshot?.settings.autoSnipe ?? false}
				>
					AUTO {snapshot?.settings.autoSnipe ? "ON" : "OFF"}
				</button>
				<button type="button" className="btn" disabled={!snapshot} onClick={onPause}>
					{risk?.paused ? "RESUME" : "PAUSE"}
				</button>
				<button type="button" className="btn" onClick={onMute} aria-pressed={!muted}>
					{muted ? "MUTED" : "SOUND"}
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
					label="Kill switch: sell everything and pause"
				>
					KILL
				</HoldButton>
			</div>
		</header>
	);
}
