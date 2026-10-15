import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import type { KrakenDesk } from "../src/engine/kraken/desk";
import type { KrakenLedger } from "../src/engine/kraken/ledger";
import { KrakenRestError } from "../src/engine/kraken/rest";
import { usdPair } from "./helpers/fakeKraken";
import { buildKrakenDesk, restRows, risingCandles } from "./helpers/krakenDesk";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const MIN = 60_000;
const dirs: string[] = [];
const desks: KrakenDesk[] = [];

afterEach(async () => {
	for (const desk of desks.splice(0)) await desk.stop();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function harness(opts: { prepare?: (ledger: KrakenLedger) => void; settings?: Record<string, unknown> } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "kdesk-"));
	dirs.push(dir);
	const rig = buildKrakenDesk({ dir, clock: new ManualClock(NOW), ...opts });
	desks.push(rig.desk);
	await rig.desk.start();
	return rig;
}

describe("KrakenDesk", () => {
	it("buys a seeded mover that meets the rule, takes profit, then waits out the re-entry cooldown", async () => {
		const h = await harness();
		h.rest.candles.set("MOONUSD", restRows(NOW));
		h.ticker("MOON", "1.059", "1.061");
		await h.clock.advance(11_000);
		expect(h.desk.snapshot().positions.map((p) => p.pair)).toEqual(["MOONUSD"]);

		// Round-trip costs are about 1.9%, so the bid must rise about 10% for +6% PnL.
		h.ticker("MOON", "1.17", "1.172");
		await h.clock.advance(400);
		const closes = h.events.filter((e) => e.type === "kraken_close");
		expect(closes.map((e) => e.type === "kraken_close" && e.trade.reason)).toEqual(["take_profit"]);

		await h.clock.advance(10_000);
		expect(h.desk.snapshot().positions).toEqual([]);
		expect(h.desk.snapshot().movers.find((m) => m.pair === "MOONUSD")?.status).toBe("cooldown");
	});

	it("never buys a wide-spread mover and counts the skip", async () => {
		const h = await harness();
		h.rest.candles.set("WIDEUSD", restRows(NOW));
		h.ticker("WIDE", "1.000", "1.009");
		await h.clock.advance(11_000);
		expect(h.events.some((e) => e.type === "kraken_order")).toBe(false);
		expect(h.desk.snapshot().scanStats.skipReasons).toContainEqual({ reason: "Wide spread", count: 1 });
	});

	it("halts a held pair that leaves the universe: no exits, and a manual sell fills at the last bid", async () => {
		const h = await harness();
		h.rest.candles.set("MOONUSD", restRows(NOW));
		h.ticker("MOON", "1.059", "1.061");
		await h.clock.advance(11_000);
		h.rest.pairs = { WIDEUSD: usdPair("WIDE") };
		await h.universe.refresh();
		expect(h.desk.snapshot().positions[0]).toMatchObject({ pair: "MOONUSD", halted: true });
		h.ticker("MOON", "0.90", "0.91");
		await h.clock.advance(2_000);
		expect(h.desk.snapshot().positions).toHaveLength(1);
		expect(await h.desk.handleCommand({ type: "kraken_sell", id: "s", pair: "MOONUSD", pct: 100 })).toEqual({
			ok: true,
		});
		await h.clock.advance(400);
		expect(h.desk.snapshot().positions).toEqual([]);
		const close = h.events.find((event) => event.type === "kraken_close");
		expect(close?.type === "kraken_close" && close.trade.reason).toBe("manual");
		// Sold at the last listed bid (1.059), not the 0.90 seen after the pair left: only round-trip costs are lost.
		expect(close?.type === "kraken_close" && close.trade.pnlPct).toBeGreaterThan(-2.5);
	});

	it("kill sells a halted position at its last bid too", async () => {
		const h = await harness();
		h.rest.candles.set("MOONUSD", restRows(NOW));
		h.ticker("MOON", "1.059", "1.061");
		await h.clock.advance(11_000);
		h.rest.pairs = { WIDEUSD: usdPair("WIDE") };
		await h.universe.refresh();
		h.desk.kill();
		await h.clock.advance(400);
		expect(h.desk.snapshot().positions).toEqual([]);
		expect(
			h.events
				.filter((event) => event.type === "kraken_close")
				.map((event) => event.type === "kraken_close" && event.trade.reason),
		).toEqual(["kill"]);
	});

	it("keeps scanning when candle seeding is rate-limited and buys once live bars cover 15 minutes", async () => {
		const h = await harness();
		h.rest.ohlcError = new KrakenRestError("Kraken /0/public/OHLC still rate-limited (HTTP 429) after 4 attempts");
		h.ticker("MOON", "1.059", "1.061");
		for (const candle of risingCandles(NOW)) {
			h.feed.emit({
				type: "bar",
				wsname: "MOON/USD",
				begin: candle.begin,
				close: String(candle.close),
				volume: String(candle.volume),
				at: NOW,
			});
		}
		await h.clock.advance(11_000);
		expect(h.rest.ohlcCalls).toContain("MOONUSD");
		expect(h.desk.snapshot().positions.map((p) => p.pair)).toEqual(["MOONUSD"]);
	});

	it("blocks auto-buys during a tilt cooldown after three losses", async () => {
		const h = await harness({
			prepare: (ledger) => {
				for (let i = 0; i < 3; i++) {
					ledger.appendFill({
						id: `b${i}`,
						positionId: `old${i}`,
						mode: "paper",
						pair: "WIDEUSD",
						symbol: "WIDE",
						side: "buy",
						usdMicros: "50000000",
						lots: "5000",
						feesUsdMicros: "400000",
						ts: NOW - (10 - i) * MIN,
					});
					ledger.appendFill({
						id: `s${i}`,
						positionId: `old${i}`,
						mode: "paper",
						pair: "WIDEUSD",
						symbol: "WIDE",
						side: "sell",
						usdMicros: "48400000",
						lots: "5000",
						feesUsdMicros: "400000",
						ts: NOW - (9 - i) * MIN,
					});
					ledger.appendClose({
						positionId: `old${i}`,
						mode: "paper",
						pnlUsdMicros: "-2400000",
						pnlPct: -4.7619,
						reason: "stop_loss",
						ts: NOW - (9 - i) * MIN,
					});
				}
			},
		});
		h.rest.candles.set("MOONUSD", restRows(NOW));
		h.ticker("MOON", "1.059", "1.061");
		await h.clock.advance(11_000);
		expect(h.desk.snapshot().positions).toEqual([]);
		expect(h.desk.snapshot().scanStats.skipReasons).toContainEqual({ reason: "Tilt cooldown", count: 1 });
	});

	it("rebuilds an open position from the ledger on restart", async () => {
		const h = await harness({
			prepare: (ledger) =>
				ledger.appendFill({
					id: "b1",
					positionId: "k1",
					mode: "paper",
					pair: "MOONUSD",
					symbol: "MOON",
					side: "buy",
					usdMicros: "50000000",
					lots: "4700000",
					feesUsdMicros: "400000",
					ts: NOW - 5 * MIN,
				}),
		});
		expect(h.desk.snapshot().positions).toMatchObject([{ id: "k1", pair: "MOONUSD", costUsdMicros: "50400000" }]);
	});

	it("logs each symbol Kraken refuses to subscribe, once", async () => {
		const h = await harness();
		const rejected = { type: "rejected", symbol: "XBT/USD", error: "Currency pair not supported XBT/USD" } as const;
		h.feed.emit(rejected);
		h.feed.emit(rejected);
		const lines = h.events.flatMap((event) => (event.type === "log" ? [event.line.message] : []));
		expect(lines.filter((line) => line.includes("XBT/USD"))).toEqual([
			"Kraken: refused XBT/USD (Currency pair not supported XBT/USD)",
		]);
	});

	it("refuses a manual buy on a price older than priceStaleSec", async () => {
		const h = await harness();
		h.ticker("MOON", "1.000", "1.001");
		await h.clock.advance(11_000);
		expect(await h.desk.handleCommand({ type: "kraken_buy", id: "b", pair: "MOONUSD", holdConfirmed: true })).toEqual(
			{ ok: false, error: "No live price for MOON" },
		);
	});

	it("skips auto-buys while the Kraken feed is down and counts why", async () => {
		const h = await harness();
		h.feed.emit({ type: "status", status: "down", dropped: 0, reconnectAt: NOW + 5_000 });
		h.rest.candles.set("MOONUSD", restRows(NOW));
		h.ticker("MOON", "1.059", "1.061");
		await h.clock.advance(11_000);
		expect(h.events.some((e) => e.type === "kraken_order")).toBe(false);
		expect(h.desk.snapshot().scanStats.skipReasons).toContainEqual({ reason: "Kraken feed down", count: 1 });
	});

	it("refuses buys beyond the paper balance, a seventh pin, and unknown pairs", async () => {
		const h = await harness({ settings: { buyUsd: 1000, paper: { startingBalanceUsd: 100 } } });
		h.ticker("MOON", "1.000", "1.001");
		expect(await h.desk.handleCommand({ type: "kraken_buy", id: "b", pair: "MOONUSD", holdConfirmed: true })).toEqual(
			{
				ok: false,
				error: "Insufficient paper balance",
			},
		);
		expect(await h.desk.handleCommand({ type: "kraken_buy", id: "x", pair: "NOPEUSD" })).toEqual({
			ok: false,
			error: "Unknown pair",
		});
		h.rest.pairs = Object.fromEntries(["A", "B", "C", "D", "E", "F", "G"].map((s) => [`${s}USD`, usdPair(s)]));
		await h.universe.refresh();
		for (const symbol of ["A", "B", "C", "D", "E", "F"]) {
			expect(await h.desk.handleCommand({ type: "kraken_pin", id: symbol, pair: `${symbol}USD` })).toEqual({
				ok: true,
			});
		}
		expect(await h.desk.handleCommand({ type: "kraken_pin", id: "g", pair: "GUSD" })).toEqual({
			ok: false,
			error: "Hotbar full (6 pins)",
		});
	});
});
