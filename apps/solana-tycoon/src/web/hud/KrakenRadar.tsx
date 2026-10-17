import { formatUsdShort, type RuleStatus } from "../../shared/kraken";
import type { GameState } from "../state/store";
import type { KrakenActions } from "./actions";
import { pct } from "./format";
import { HoldButton } from "./HoldButton";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	actions: KrakenActions;
	hold: HoldController;
}

const STATUS_CLASS: Record<RuleStatus, string> = {
	eligible: "v-approved",
	warming_up: "v-pending",
	held: "v-unchecked",
	cooldown: "v-unchecked",
	low_volume: "v-skip",
	wide_spread: "v-skip",
	small_move: "v-skip",
	not_rising: "v-skip",
	no_volume_surge: "v-skip",
};

const statusText = (status: RuleStatus) => status.replace(/_/g, " ").toUpperCase();

export function KrakenRadar({ state, actions, hold }: Props) {
	const kraken = state.snapshot?.kraken ?? null;
	const movers = kraken?.movers ?? [];
	const held = new Set(kraken?.positions.map((position) => position.pair) ?? []);
	const pinned = new Set(kraken?.pinned ?? []);
	const eligible = movers.filter((mover) => mover.status === "eligible").length;

	return (
		<section className="panel" id="radar" aria-label="Kraken movers">
			<h2>
				<span title="Top 50 USD pairs by 15-minute move. The rule reduces noise; it does not predict prices.">
					KRAKEN MOVERS
				</span>
				<b>
					{eligible}/{movers.length} ELIGIBLE
				</b>
			</h2>
			<ul className="scroll list">
				{kraken?.error ? (
					<li className="empty offline-note">KRAKEN OFFLINE: {kraken.error}</li>
				) : movers.length === 0 ? (
					<li className="empty">Scanning Kraken USD pairs...</li>
				) : (
					movers.map((mover) => {
						const order = state.kraken.orders[mover.pair];
						const buying = order?.side === "buy" && order.status === "pending";
						const needsHold = actions.needsHold(mover.pair);
						return (
							<li key={mover.pair} className={`row ${state.selectedPair === mover.pair ? "sel" : ""}`}>
								<button type="button" className="row-main" onClick={() => actions.select(mover.pair)}>
									<span className="sym">{mover.symbol}</span>
									<span className="meta">{mover.last}</span>
								</button>
								<span className={`verdict ${STATUS_CLASS[mover.status]}`}>{statusText(mover.status)}</span>
								<span className="kmetrics">
									<span title="5-minute change">5M {pct(mover.change5m)}</span>
									<span title="15-minute change">15M {pct(mover.change15m)}</span>
									<span title="60-minute change">1H {pct(mover.change60m)}</span>
									<span title="24-hour volume">{formatUsdShort(mover.volumeUsd24h)}</span>
									<span title="Bid-ask spread">SPR {mover.spreadPct.toFixed(2)}%</span>
								</span>
								<span className="reason" title={mover.reason}>
									{mover.reason}
								</span>
								<span className="acts">
									<HoldButton
										id={`kbuy:${mover.pair}`}
										hold={hold}
										needsHold={needsHold}
										onConfirm={() => actions.buy(mover.pair, actions.needsHold(mover.pair))}
										className="mini go"
										disabled={held.has(mover.pair) || buying}
										label={`Buy ${mover.symbol}`}
									>
										{held.has(mover.pair) ? "HELD" : buying ? "BUYING" : needsHold ? "HOLD BUY" : "BUY"}
									</HoldButton>
									<button
										type="button"
										className="mini"
										aria-pressed={pinned.has(mover.pair)}
										onClick={() =>
											pinned.has(mover.pair) ? actions.unpin(mover.pair) : actions.pin(mover.pair)
										}
									>
										{pinned.has(mover.pair) ? "UNPIN" : "PIN"}
									</button>
								</span>
							</li>
						);
					})
				)}
			</ul>
		</section>
	);
}
