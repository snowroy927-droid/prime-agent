import type { KrakenFill, KrakenPair, KrakenSettings } from "../../shared/kraken";
import type { Mode, Side } from "../../shared/types";
import type { Clock } from "../clock";
import { quoteBuy, quoteSell, toScaled } from "./money";
import type { PairUniverse } from "./pairs";

export type KrakenFillResult = { ok: true; fill: KrakenFill } | { ok: false; error: string };

export interface KrakenPaperDeps {
	mode: Mode;
	clock: Clock;
	settings: () => KrakenSettings;
	universe: PairUniverse;
	quote: (pair: string) => { bid: string; ask: string; at: number } | null;
	halted: (pair: string) => boolean;
}

// Paper fills at the live Kraken bid/ask after a latency delay, with slippage and taker fees (Task 2 math).
// A buy records its notional, a sell its gross amount; fees sit beside them in feesUsdMicros.
export class KrakenPaperExecutor {
	constructor(private readonly deps: KrakenPaperDeps) {}

	async buy(r: { positionId: string; pair: string; usdMicros: bigint }): Promise<KrakenFillResult> {
		const paper = this.deps.settings().paper;
		await this.deps.clock.sleep(paper.latencyMs);
		const pair = this.deps.universe.byPair(r.pair);
		if (!pair || this.deps.halted(r.pair)) return { ok: false, error: "Pair halted" };
		const quote = this.deps.quote(r.pair);
		if (!quote) return { ok: false, error: `No price for ${pair.symbol}` };
		// Spec §6: a buy fills at the ask "at that moment"; an ask older than priceStaleSec is not one.
		if (this.deps.clock.now() - quote.at > this.deps.settings().priceStaleSec * 1000) {
			return { ok: false, error: `No live price for ${pair.symbol}` };
		}
		const result = quoteBuy(r.usdMicros, toScaled(quote.ask, pair.priceDecimals), pair, paper);
		if (!result.ok) return result;
		return this.filled(
			r.positionId,
			pair.pair,
			pair.symbol,
			"buy",
			result.notionalUsdMicros,
			result.lots,
			result.feesUsdMicros,
		);
	}

	// A halted pair sells only with `lastResort`: the pair's details and last bid from while it was listed
	// (spec Section 13: manual SELL tries at the last bid).
	async sell(r: {
		positionId: string;
		pair: string;
		lots: bigint;
		lastResort?: { info: KrakenPair; bid: string };
	}): Promise<KrakenFillResult> {
		const paper = this.deps.settings().paper;
		await this.deps.clock.sleep(paper.latencyMs);
		const listed = this.deps.universe.byPair(r.pair);
		let pair: KrakenPair;
		let bid: string;
		if (!listed || this.deps.halted(r.pair)) {
			if (!r.lastResort) return { ok: false, error: "Pair halted" };
			pair = r.lastResort.info;
			bid = r.lastResort.bid;
		} else {
			const quote = this.deps.quote(r.pair);
			if (!quote) return { ok: false, error: `No price for ${listed.symbol}` };
			pair = listed;
			bid = quote.bid;
		}
		const result = quoteSell(r.lots, toScaled(bid, pair.priceDecimals), pair, paper);
		if (!result.ok) return result;
		const gross = result.proceedsUsdMicros + result.feesUsdMicros;
		return this.filled(r.positionId, pair.pair, pair.symbol, "sell", gross, r.lots, result.feesUsdMicros);
	}

	private filled(
		positionId: string,
		pair: string,
		symbol: string,
		side: Side,
		usdMicros: bigint,
		lots: bigint,
		feesUsdMicros: bigint,
	): KrakenFillResult {
		return {
			ok: true,
			fill: {
				id: crypto.randomUUID(),
				positionId,
				mode: this.deps.mode,
				pair,
				symbol,
				side,
				usdMicros: usdMicros.toString(),
				lots: lots.toString(),
				feesUsdMicros: feesUsdMicros.toString(),
				ts: this.deps.clock.now(),
			},
		};
	}
}
