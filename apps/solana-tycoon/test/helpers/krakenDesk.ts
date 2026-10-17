import { join } from "node:path";
import type { ManualClock } from "../../src/engine/clock";
import { assembleKrakenDesk } from "../../src/engine/kraken/assemble";
import { KrakenLedger } from "../../src/engine/kraken/ledger";
import type { KrakenEvent } from "../../src/shared/kraken";
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
	const ledgerPath = join(opts.dir, "ledger-kraken.jsonl");
	opts.prepare?.(new KrakenLedger(ledgerPath));
	const events: KrakenEvent[] = [];
	const { desk, universe, settings } = assembleKrakenDesk({
		mode: "paper",
		synthetic: false,
		feed,
		rest,
		clock,
		settingsPath: join(opts.dir, "settings-kraken.json"),
		ledgerPath,
		emit: (event) => {
			events.push(event);
			opts.emit?.(event);
		},
		tzOffsetMin: () => 0,
	});
	if (opts.settings && !settings.update(opts.settings).ok) throw new Error("invalid test settings");
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
