import type { GameState } from "../state/store";
import type { HudActions } from "./actions";
import { age } from "./format";
import { HoldButton } from "./HoldButton";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	actions: HudActions;
	hold: HoldController;
}

export function Radar({ state, actions, hold }: Props) {
	const snapshot = state.snapshot;
	const launches = snapshot?.launches ?? [];
	const held = new Set(snapshot?.positions.map((position) => position.mint) ?? []);
	const pinned = new Set(snapshot?.pinned ?? []);
	const passRate = snapshot?.launchStats.passRate ?? 0;

	return (
		<section className="panel" id="radar" aria-label="Launch radar">
			<h2>
				<span title="Rug checks reduce risk. They do not detect intent.">LAUNCH RADAR</span>
				<b>
					{launches.length} | PASS {(passRate * 100).toFixed(0)}%
				</b>
			</h2>
			<ul className="scroll list">
				{launches.length === 0 ? (
					<li className="empty">Waiting for launches from PumpPortal...</li>
				) : (
					launches.map(({ launch, check }) => {
						const order = state.orders[launch.mint];
						const buying = order?.side === "buy" && order.status === "pending";
						const verdict = check?.verdict ?? "pending";
						return (
							<li key={launch.mint} className={`row ${state.selectedMint === launch.mint ? "sel" : ""}`}>
								<button type="button" className="row-main" onClick={() => actions.select(launch.mint)}>
									<span className="sym">{launch.symbol}</span>
									<span className="meta">
										{age(state.now - launch.receivedAt)}
										{launch.marketCapSol !== null ? ` | ${launch.marketCapSol.toFixed(1)} SOL` : ""}
									</span>
								</button>
								<span className={`verdict v-${verdict}`}>{verdict.toUpperCase()}</span>
								<span className="reason" title={check?.reason}>
									{check ? check.reason : launch.name}
								</span>
								<span className="acts">
									<HoldButton
										id={`snipe:${launch.mint}`}
										hold={hold}
										needsHold={actions.needsHold(launch.mint)}
										onConfirm={() => actions.snipe(launch.mint, actions.needsHold(launch.mint))}
										className="mini go"
										disabled={held.has(launch.mint) || buying}
										label={`Snipe ${launch.symbol}`}
									>
										{held.has(launch.mint)
											? "HELD"
											: buying
												? "BUYING"
												: actions.needsHold(launch.mint)
													? "HOLD SNIPE"
													: "SNIPE"}
									</HoldButton>
									<button
										type="button"
										className="mini"
										aria-pressed={pinned.has(launch.mint)}
										onClick={() =>
											pinned.has(launch.mint) ? actions.unpin(launch.mint) : actions.pin(launch.mint)
										}
									>
										{pinned.has(launch.mint) ? "UNPIN" : "PIN"}
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
