import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { BarBook } from "../src/engine/kraken/bars";
import { KRAKEN_RISK_COPY, KrakenDesk, krakenLimits } from "../src/engine/kraken/desk";
import { KrakenLedger } from "../src/engine/kraken/ledger";
import { PairUniverse } from "../src/engine/kraken/pairs";
import { KrakenPaperExecutor } from "../src/engine/kraken/paper";
import { KrakenRestError } from "../src/engine/kraken/rest";
import { RiskGuard } from "../src/engine/risk/guard";
import { JsonSettingsStore } from "../src/engine/settingsStore";
import { applyKrakenSettingsPatch, DEFAULT_KRAKEN_SETTINGS, type KrakenEvent } from "../src/shared/kraken";
import { FakeKrakenFeed, FakeKrakenRest, usdPair } from "./helpers/fakeKraken";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const MIN = 60_000;
const dirs: string[] = [];
const desks: KrakenDesk[] = [];

afterEach(async () => {
	for (const desk of desks.splice(0)) await desk.stop();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// One-minute candles for the last hour: flat at 1.00, then rising to 1.06 over the last 15 minutes on heavy volume.
function risingCandles(now: number): { begin: number; close: number; volume: number }[] {
	return Array.from({ length: 60 }, (_, i) => {
		const minutesAgo = 60 - i;
		const close = minutesAgo > 15 ? 1 : 1 + (16 - minutesAgo) * 0.004;
		return { begin: now - minutesAgo * MIN, close, volume: minutesAgo > 15 ? 100 : 1_000 };
	});
}

const restRows = (now: number) =>
	risingCandles(now).map((c) => [c.begin / 1000, "1", "1", "1", String(c.close), "1", String(c.volume), 10]);

async function harness(opts: { prepare?: (ledger: KrakenLedger) => void; settings?: Record<string, unknown> } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "kdesk-"));
	dirs.push(dir);
	const clock = new ManualClock(NOW);
	const rest = new FakeKrakenRest();
	rest.pairs = { MOONUSD: usdPair("MOON"), WIDEUSD: usdPair("WIDE") };
	const feed = new FakeKrakenFeed();
	const settings = new JsonSettingsStore(
		join(dir, "settings.json"),
		DEFAULT_KRAKEN_SETTINGS,
		applyKrakenSettingsPatch,
	);
	if (opts.settings) expect(settings.update(opts.settings).ok).toBe(true);
	const ledgerPath = join(dir, "ledger.jsonl");
	opts.prepare?.(new KrakenLedger(ledgerPath));
	const universe = new PairUniverse({ rest, clock, settings: () => settings.get() });
	const risk = new RiskGuard({
		clock,
		limits: () => krakenLimits(settings.get()),
		copy: KRAKEN_RISK_COPY,
		tzOffsetMin: () => 0,
	});
	let desk: KrakenDesk | null = null;
	const executor = new KrakenPaperExecutor({
		mode: "paper",
		clock,
		settings: () => settings.get(),
		universe,
		quote: (pair) => desk?.quote(pair) ?? null,
		halted: (pair) => desk?.isHalted(pair) ?? false,
	});
	const events: KrakenEvent[] = [];
	desk = new KrakenDesk({
		mode: "paper",
		synthetic: false,
		feed,
		rest,
		universe,
		bars: new BarBook(),
		executor,
		ledger: new KrakenLedger(ledgerPath),
		settings,
		risk,
		clock,
		emit: (event) => events.push(event),
		tzOffsetMin: () => 0,
	});
	desks.push(desk);
	await desk.start();
	const ticker = (symbol: string, bid: string, ask: string) =>
		feed.emit({
			type: "ticker",
			wsname: `${symbol}/USD`,
			bid,
			ask,
			last: bid,
			volume24h: "1000000",
			vwap24h: "1",
			at: clock.now(),
		});
	return { clock, rest, feed, universe, desk, events, ticker };
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

	it("halts a held pair that leaves the universe: no exits, and manual sell is refused", async () => {
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
			ok: false,
			error: "Pair halted",
		});
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

	it("refuses buys beyond the paper balance, a seventh pin, and unknown pairs", async () => {
		const h = await harness({ settings: { buyUsd: 1000, paper: { startingBalanceUsd: 100 } } });
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
