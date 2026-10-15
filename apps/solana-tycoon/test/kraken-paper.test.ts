import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { quoteBuy } from "../src/engine/kraken/money";
import { PairUniverse } from "../src/engine/kraken/pairs";
import { KrakenPaperExecutor } from "../src/engine/kraken/paper";
import type { KrakenRestLike } from "../src/engine/kraken/rest";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";

const rest: KrakenRestLike = { assetPairs: async () => ({}), ticker: async () => ({}), ohlc: async () => ({}) };

function setup() {
	const clock = new ManualClock(0);
	const universe = new PairUniverse({ rest, clock, settings: () => DEFAULT_KRAKEN_SETTINGS });
	universe.apply({
		PEPEUSD: { altname: "PEPEUSD", wsname: "PEPE/USD", quote: "ZUSD", pair_decimals: 8, lot_decimals: 0 },
	});
	let quote: { bid: string; ask: string; at: number } | null = { bid: "0.00001200", ask: "0.00001234", at: 0 };
	const halted = new Set<string>();
	const executor = new KrakenPaperExecutor({
		mode: "paper",
		clock,
		settings: () => DEFAULT_KRAKEN_SETTINGS,
		universe,
		quote: () => quote,
		halted: (pair) => halted.has(pair),
	});
	return {
		clock,
		executor,
		halted,
		universe,
		setQuote: (next: typeof quote) => {
			quote = next;
		},
	};
}

describe("KrakenPaperExecutor", () => {
	it("waits the paper latency, then fills at the ask in effect after the wait", async () => {
		const h = setup();
		const pending = h.executor.buy({ positionId: "k1", pair: "PEPEUSD", usdMicros: 50_000_000n });
		await h.clock.advance(100);
		h.setQuote({ bid: "0.00001300", ask: "0.00001320", at: 100 });
		await h.clock.advance(200);
		const result = await pending;
		const pair = h.universe.byPair("PEPEUSD");
		if (!pair) throw new Error("fixture pair missing");
		const expected = quoteBuy(50_000_000n, 1320n, pair, DEFAULT_KRAKEN_SETTINGS.paper);
		if (!expected.ok || !result.ok) throw new Error("expected fills");
		expect(result.fill).toMatchObject({
			positionId: "k1",
			mode: "paper",
			pair: "PEPEUSD",
			symbol: "PEPE",
			side: "buy",
			usdMicros: expected.notionalUsdMicros.toString(),
			lots: expected.lots.toString(),
			feesUsdMicros: expected.feesUsdMicros.toString(),
			ts: 300,
		});
	});

	it("records a sell at its gross amount with fees beside it", async () => {
		const h = setup();
		const pending = h.executor.sell({ positionId: "k1", pair: "PEPEUSD", lots: 4_045_795n });
		h.setQuote({ bid: "0.00001300", ask: "0.00001320", at: 0 });
		await h.clock.advance(300);
		const result = await pending;
		expect(result).toMatchObject({
			ok: true,
			fill: { side: "sell", usdMicros: "52516441", feesUsdMicros: "420132", lots: "4045795" },
		});
	});

	it("refuses a halted pair and a pair without a price", async () => {
		const h = setup();
		h.halted.add("PEPEUSD");
		const halted = h.executor.buy({ positionId: "k1", pair: "PEPEUSD", usdMicros: 50_000_000n });
		await h.clock.advance(300);
		expect(await halted).toEqual({ ok: false, error: "Pair halted" });
		h.halted.clear();
		h.setQuote(null);
		const unpriced = h.executor.buy({ positionId: "k2", pair: "PEPEUSD", usdMicros: 50_000_000n });
		await h.clock.advance(300);
		expect(await unpriced).toEqual({ ok: false, error: "No price for PEPE" });
	});
});
