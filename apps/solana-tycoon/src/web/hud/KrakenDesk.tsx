import { KRAKEN_TROPHIES, type KrakenTrophyId } from "../../shared/progression";
import type { GameState } from "../state/store";
import type { KrakenActions } from "./actions";
import { age, pct, usdAmount } from "./format";

interface Props {
	state: GameState;
	actions: KrakenActions;
}

const TROPHY_NAMES: Record<KrakenTrophyId, string> = {
	inky_bronze: "Bronze tentacle",
	inky_silver: "Silver tentacle",
	inky_gold: "Gold tentacle",
};

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;

export function KrakenDeskPanel({ state, actions }: Props) {
	const kraken = state.snapshot?.kraken ?? null;
	const positions = kraken?.positions ?? [];
	const stats = kraken?.stats;
	const unlocked = new Set(state.kraken.trophies);
	const max = kraken?.settings.maxPositions ?? 5;

	return (
		<section className="panel" id="desk" aria-label="Kraken desk">
			<h2>
				<span>KRAKEN DESK</span>
				<b>
					{positions.length}/{max} OPEN
				</b>
			</h2>
			<ul className="scroll list">
				{kraken?.error ? (
					<li className="empty offline-note">KRAKEN OFFLINE: {kraken.error}</li>
				) : positions.length === 0 ? (
					<li className="empty">No open positions. Eligible movers auto-buy while AUTO is on.</li>
				) : (
					positions.map((position) => {
						const pnl = position.pnlPct;
						const width = Math.min(50, Math.abs(pnl ?? 0) * 2);
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
									<span>IN {usdAmount(position.costUsdMicros)}</span>
									<span>
										NOW {position.valueUsdMicros === null ? "--" : usdAmount(position.valueUsdMicros)}
									</span>
									<span className={position.stale ? "stale" : ""}>
										{position.stale ? "STALE" : position.priceAt ? age(state.now - position.priceAt) : "--"}
									</span>
								</div>
								<div className="tags">
									{position.halted ? (
										<span
											className="tag-chip bad"
											title="Kraken no longer lists this pair as online: no automatic exits; SELL uses the last listed bid"
										>
											HALTED
										</span>
									) : null}
									{position.stale ? (
										<span className="tag-chip" title="No fresh price: automatic exits are paused">
											STALE
										</span>
									) : null}
									{position.pendingOrder ? <span className="tag-chip">ORDER PENDING</span> : null}
								</div>
								<div className="acts">
									<button
										type="button"
										className="mini"
										disabled={position.pendingOrder}
										onClick={() => actions.sell(position.pair, 50)}
									>
										SELL 50%
									</button>
									<button
										type="button"
										className="mini go"
										disabled={position.pendingOrder}
										onClick={() => actions.sell(position.pair, 100)}
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
					<div className="v">{stats && stats.trades > 0 ? usd(stats.expectancy) : "--"}</div>
				</div>
				<div className="stat">
					<div className="k">REALIZED</div>
					<div className="v">{stats ? usd(stats.realized) : "--"}</div>
				</div>
				<div className="stat">
					<div className="k">PROFIT FACTOR</div>
					<div className="v">{stats?.profitFactor != null ? stats.profitFactor.toFixed(2) : "--"}</div>
				</div>
			</div>
			<div className="office">
				<div className="k">INKY TROPHIES</div>
				{KRAKEN_TROPHIES.map((trophy) => (
					<div key={trophy.id} className={`up ${unlocked.has(trophy.id) ? "got" : ""}`}>
						<span>{TROPHY_NAMES[trophy.id]}</span>
						<span>{unlocked.has(trophy.id) ? "UNLOCKED" : `+$${trophy.atUsd.toLocaleString("en-US")}`}</span>
					</div>
				))}
			</div>
		</section>
	);
}
