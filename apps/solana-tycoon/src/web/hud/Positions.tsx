import { UPGRADES } from "../../shared/progression";
import type { GameState } from "../state/store";
import type { HudActions } from "./actions";
import { age, pct, solAmount } from "./format";

interface Props {
	state: GameState;
	actions: HudActions;
}

const UPGRADE_NAMES: Record<(typeof UPGRADES)[number]["id"], string> = {
	neon_sign: "Neon sign",
	plants_coffee: "Plants + coffee",
	second_row: "Second desk row",
	trophy_wall: "Trophy wall",
	space_window: "Space window",
	gold_vault: "Gold vault",
};

export function Positions({ state, actions }: Props) {
	const snapshot = state.snapshot;
	const positions = snapshot?.positions ?? [];
	const stats = snapshot?.stats;
	const unlocked = new Set(state.upgrades);
	const max = snapshot?.settings.maxPositions ?? 3;

	return (
		<section className="panel" id="desk" aria-label="Trading desk">
			<h2>
				<span>TRADING DESK</span>
				<b>
					{positions.length}/{max} OPEN
				</b>
			</h2>
			<ul className="scroll list">
				{positions.length === 0 ? (
					<li className="empty">No open positions. Approved launches auto-snipe while AUTO is on.</li>
				) : (
					positions.map((position) => {
						const pnl = position.pnlPct;
						const width = Math.min(50, Math.abs(pnl ?? 0) / 4);
						return (
							<li key={position.id} className="pos">
								<div className="top">
									<span className="sym">{position.symbol}</span>
									<span className={`pct ${pnl === null ? "" : pnl >= 0 ? "up" : "down"}`}>{pct(pnl)}</span>
								</div>
								<div className="track" aria-hidden="true">
									<span
										className="fill"
										style={{
											left: pnl !== null && pnl < 0 ? `${50 - width}%` : "50%",
											width: `${width}%`,
											background: pnl !== null && pnl < 0 ? "var(--bad)" : "var(--good)",
										}}
									/>
									<span className="zero" style={{ left: "50%" }} />
								</div>
								<div className="meta">
									<span>IN {solAmount(position.costLamports)}</span>
									<span>NOW {position.valueLamports === null ? "--" : solAmount(position.valueLamports)}</span>
									<span className={position.stale ? "stale" : ""}>
										{position.stale ? "STALE" : position.priceAt ? age(state.now - position.priceAt) : "--"}
									</span>
								</div>
								<div className="tags">
									{position.migrated ? <span className="tag-chip">MIGRATED</span> : null}
									{position.pendingOrder ? <span className="tag-chip">ORDER PENDING</span> : null}
								</div>
								<div className="acts">
									<button
										type="button"
										className="mini"
										disabled={position.pendingOrder}
										onClick={() => actions.sell(position.mint, 50)}
									>
										SELL 50%
									</button>
									<button
										type="button"
										className="mini go"
										disabled={position.pendingOrder}
										onClick={() => actions.sell(position.mint, 100)}
									>
										SELL 100%
									</button>
								</div>
							</li>
						);
					})
				)}
			</ul>
			<div className="stats">
				<div className="stat">
					<div className="k">WIN RATE</div>
					<div className="v">{stats && stats.trades > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : "--"}</div>
				</div>
				<div className="stat">
					<div className="k">EXPECTANCY</div>
					<div className="v">{stats && stats.trades > 0 ? stats.expectancySol.toFixed(4) : "--"}</div>
				</div>
				<div className="stat">
					<div className="k">REALIZED</div>
					<div className="v">{stats ? stats.realizedSol.toFixed(4) : "--"}</div>
				</div>
				<div className="stat">
					<div className="k">PROFIT FACTOR</div>
					<div className="v">{stats?.profitFactor != null ? stats.profitFactor.toFixed(2) : "--"}</div>
				</div>
			</div>
			<div className="office">
				<div className="k">OFFICE UPGRADES</div>
				{UPGRADES.map((upgrade) => (
					<div key={upgrade.id} className={`up ${unlocked.has(upgrade.id) ? "got" : ""}`}>
						<span>{UPGRADE_NAMES[upgrade.id]}</span>
						<span>{unlocked.has(upgrade.id) ? "UNLOCKED" : `+${upgrade.atSol} SOL`}</span>
					</div>
				))}
			</div>
		</section>
	);
}
