import type { GameState } from "../state/store";
import type { HudActions } from "./actions";
import { pct, price } from "./format";
import { HoldButton } from "./HoldButton";
import type { ActionId } from "./keybindings";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	actions: HudActions;
	hold: HoldController;
	bindings: Record<ActionId, string>;
}

const SLOTS = ["hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6"] as const;

export function Hotbar({ state, actions, hold, bindings }: Props) {
	const snapshot = state.snapshot;
	const pinned = snapshot?.pinned ?? [];
	const symbols = new Map(snapshot?.launches.map((entry) => [entry.launch.mint, entry.launch.symbol]) ?? []);
	const positions = new Map(snapshot?.positions.map((position) => [position.mint, position]) ?? []);

	return (
		<section className="hotbar" aria-label="Pinned coins">
			{SLOTS.map((slot, index) => {
				const mint = pinned[index];
				const key = bindings[slot].toUpperCase();
				if (!mint) {
					return (
						<div key={slot} className="slot">
							<span className="key">{key}</span>
							<span className="s dim">PIN A COIN</span>
						</div>
					);
				}
				const symbol = symbols.get(mint) ?? mint.slice(0, 4);
				const position = positions.get(mint);
				return (
					<div key={slot} className="slot full">
						<HoldButton
							id={`hotbar:${mint}`}
							hold={hold}
							needsHold={actions.needsHold(mint)}
							onConfirm={() => actions.snipe(mint, actions.needsHold(mint))}
							className="slot-snipe"
							disabled={position !== undefined}
							label={`Snipe ${symbol}`}
						>
							<span className="key">{key}</span>
							<span className="s">{symbol}</span>
							<span className="p">{position ? pct(position.pnlPct) : price(state.prices[mint]?.priceSol)}</span>
						</HoldButton>
						<button
							type="button"
							className="unpin"
							aria-label={`Unpin ${symbol}`}
							onClick={() => actions.unpin(mint)}
						>
							x
						</button>
					</div>
				);
			})}
		</section>
	);
}
