import { join } from "node:path";
import type { ManualClock } from "../../src/engine/clock";
import { BarBook } from "../../src/engine/kraken/bars";
import { KRAKEN_RISK_COPY, KrakenDesk, krakenLimits } from "../../src/engine/kraken/desk";
import { KrakenLedger } from "../../src/engine/kraken/ledger";
import { PairUniverse } from "../../src/engine/kraken/pairs";
import { KrakenPaperExecutor } from "../../src/engine/kraken/paper";
import { RiskGuard } from "../../src/engine/risk/guard";
import { JsonSettingsStore } from "../../src/engine/settingsStore";
import { applyKrakenSettingsPatch, DEFAULT_KRAKEN_SETTINGS, type KrakenEvent } from "../../src/shared/kraken";
import { FakeKrakenFeed, FakeKrakenRest, usdPair } from "./fakeKraken";

const MIN = 60_000;

// One-minute candles for the last hour: flat at 1.00, then rising to 1.06 over the last 15 minutes on heavy volume.
export function risingCandles(now: number): { begin: number; close: number; volume: number }[] {
	return Array.from({ length: 60 }, (_, i) => {
		const minutesAgo = 60 - i;
		const close = minutesAgo > 15 ? 1 : 1 + (16 - minutesAgo) * 0.004;
		return { begin: now - minutesAgo * MIN, close, volume: minutesAgo > 15 ? 100 : 1_000 };
	});
}

export const restRows = (now: number) =>
	risingCandles(now).map((c) => [c.begin / 1000, "1", "1", "1", String(c.close), "1", String(c.volume), 10]);

export function buildKrakenDesk(opts: {
	dir: string;
	clock: ManualClock;
	emit?: (event: KrakenEvent) => void;
	prepare?: (ledger: KrakenLedger) => void;
	settings?: Record<string, unknown>;
}) {
	const { clock } = opts;
	const rest = new FakeKrakenRest();
	rest.pairs = { MOONUSD: usdPair("MOON"), WIDEUSD: usdPair("WIDE") };
	const feed = new FakeKrakenFeed();
	const settings = new JsonSettingsStore(
		join(opts.dir, "settings-kraken.json"),
		DEFAULT_KRAKEN_SETTINGS,
		applyKrakenSettingsPatch,
	);
	if (opts.settings && !settings.update(opts.settings).ok) throw new Error("invalid test settings");
	const ledgerPath = join(opts.dir, "ledger-kraken.jsonl");
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
		emit: (event) => {
			events.push(event);
			opts.emit?.(event);
		},
		tzOffsetMin: () => 0,
	});
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
