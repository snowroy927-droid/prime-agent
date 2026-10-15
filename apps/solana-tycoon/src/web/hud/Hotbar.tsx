import type { DeskId, GameState } from "../state/store";
import type { HudActions, KrakenActions } from "./actions";
import { pct, price } from "./format";
import { HoldButton } from "./HoldButton";
import type { ActionId } from "./keybindings";
import type { HoldController } from "./useHold";

interface Props {
	state: GameState;
	desk: DeskId;
	actions: HudActions;
	krakenActions: KrakenActions;
	hold: HoldController;
	bindings: Record<ActionId, string>;
}

interface Slot {
	id: string;
	symbol: string;
	value: string;
	held: boolean;
	needsHold: boolean;
	verb: string;
	onBuy: () => void;
	onUnpin: () => void;
}

const SLOTS = ["hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5", "hotbar6"] as const;

function pumpSlots(state: GameState, actions: HudActions): Slot[] {
	const snapshot = state.snapshot;
	const symbols = new Map(snapshot?.launches.map((entry) => [entry.launch.mint, entry.launch.symbol]) ?? []);
	const positions = new Map(snapshot?.positions.map((position) => [position.mint, position]) ?? []);
	return (snapshot?.pinned ?? []).map((mint) => {
		const position = positions.get(mint);
		return {
			id: mint,
			symbol: symbols.get(mint) ?? mint.slice(0, 4),
			value: position ? pct(position.pnlPct) : price(state.prices[mint]?.priceSol),
			held: position !== undefined,
			needsHold: actions.needsHold(mint),
			verb: "Snipe",
			onBuy: () => actions.snipe(mint, actions.needsHold(mint)),
			onUnpin: () => actions.unpin(mint),
		};
	});
}

function krakenSlots(state: GameState, actions: KrakenActions): Slot[] {
	const kraken = state.snapshot?.kraken;
	const movers = new Map(kraken?.movers.map((mover) => [mover.pair, mover]) ?? []);
	const positions = new Map(kraken?.positions.map((position) => [position.pair, position]) ?? []);
	return (kraken?.pinned ?? []).map((pair) => {
		const position = positions.get(pair);
		const mover = movers.get(pair);
		return {
			id: pair,
			symbol: position?.symbol ?? mover?.symbol ?? pair.replace(/USD$/, ""),
			value: position ? pct(position.pnlPct) : (state.kraken.prices[pair]?.last ?? mover?.last ?? "--"),
			held: position !== undefined,
			needsHold: actions.needsHold(pair),
			verb: "Buy",
			onBuy: () => actions.buy(pair, actions.needsHold(pair)),
			onUnpin: () => actions.unpin(pair),
		};
	});
}

export function Hotbar({ state, desk, actions, krakenActions, hold, bindings }: Props) {
	const slots = desk === "kraken" ? krakenSlots(state, krakenActions) : pumpSlots(state, actions);

	return (
		<section className="hotbar" aria-label={desk === "kraken" ? "Pinned pairs" : "Pinned coins"}>
			{SLOTS.map((slotKey, index) => {
				const slot = slots[index];
				const key = bindings[slotKey].toUpperCase();
				if (!slot) {
					return (
						<div key={slotKey} className="slot">
							<span className="key">{key}</span>
							<span className="s dim">{desk === "kraken" ? "PIN A PAIR" : "PIN A COIN"}</span>
						</div>
					);
				}
				return (
					<div key={slotKey} className="slot full">
						<HoldButton
							id={`hotbar:${slot.id}`}
							hold={hold}
							needsHold={slot.needsHold}
							onConfirm={slot.onBuy}
							className="slot-snipe"
							disabled={slot.held}
							label={`${slot.verb} ${slot.symbol}`}
						>
							<span className="key">{key}</span>
							<span className="s">{slot.symbol}</span>
							<span className="p">{slot.value}</span>
						</HoldButton>
						<button type="button" className="unpin" aria-label={`Unpin ${slot.symbol}`} onClick={slot.onUnpin}>
							x
						</button>
					</div>
				);
			})}
		</section>
	);
}
