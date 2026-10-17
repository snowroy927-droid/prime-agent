import type { KrakenSettings, Mover } from "../../shared/kraken";
import type { Clock } from "../clock";
import type { BarBook } from "./bars";
import type { KrakenFeedEvent } from "./feed";
import type { PairUniverse } from "./pairs";
import { evaluateRule } from "./rule";

const RADAR_MAX = 50;

type Ticker = Extract<KrakenFeedEvent, { type: "ticker" }>;

export interface ScannerDeps {
	universe: PairUniverse;
	bars: BarBook;
	clock: Clock;
	settings: () => KrakenSettings;
	held: (pair: string) => boolean;
	cooldownUntil: (pair: string) => number | null;
	tzOffsetMin: () => number;
}

export class Scanner {
	private readonly tickers = new Map<string, Ticker>();
	private readonly seedListed = new Set<string>();

	constructor(private readonly deps: ScannerDeps) {}

	onTicker(event: Ticker): void {
		this.tickers.set(event.wsname, event);
	}

	quote(pair: string): { bid: string; ask: string; last: string; at: number } | null {
		const known = this.deps.universe.byPair(pair);
		const ticker = known ? this.tickers.get(known.wsname) : undefined;
		return ticker ? { bid: ticker.bid, ask: ticker.ask, last: ticker.last, at: ticker.at } : null;
	}

	volumeUsd24h(wsname: string): number {
		const ticker = this.tickers.get(wsname);
		if (!ticker) return 0;
		return Number(ticker.volume24h) * Number(ticker.vwap24h ?? ticker.last);
	}

	// Only the volume floor filters the radar; spread is a rule status so a wide-spread mover stays visible
	// with its reason.
	scan(): Mover[] {
		const s = this.deps.settings();
		const now = this.deps.clock.now();
		const movers: Mover[] = [];
		for (const pair of this.deps.universe.all()) {
			const ticker = this.tickers.get(pair.wsname);
			if (!ticker) continue;
			const volumeUsd24h = this.volumeUsd24h(pair.wsname);
			if (volumeUsd24h < s.scan.minVolumeUsd24h) continue;
			const bid = Number(ticker.bid);
			const ask = Number(ticker.ask);
			const mid = (bid + ask) / 2;
			const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : Number.POSITIVE_INFINITY;
			const change5m = this.deps.bars.change(pair.wsname, 5, now);
			const change15m = this.deps.bars.change(pair.wsname, 15, now);
			const verdict = evaluateRule(
				{
					change5m,
					change15m,
					volumeUsd24h,
					spreadPct,
					usdVolume15m: this.deps.bars.usdVolume(pair.wsname, 15, now),
					usdVolume60m: this.deps.bars.usdVolume(pair.wsname, 60, now),
					minutesCovered: this.deps.bars.minutesCovered(pair.wsname, now),
					held: this.deps.held(pair.pair),
					cooldownUntil: this.deps.cooldownUntil(pair.pair),
					now,
					tzOffsetMin: this.deps.tzOffsetMin(),
				},
				s,
			);
			movers.push({
				pair: pair.pair,
				symbol: pair.symbol,
				last: ticker.last,
				bid: ticker.bid,
				ask: ticker.ask,
				change5m,
				change15m,
				change60m: this.deps.bars.change(pair.wsname, 60, now),
				volumeUsd24h,
				spreadPct,
				status: verdict.status,
				reason: verdict.reason,
			});
		}
		movers.sort((a, b) => (b.change15m ?? Number.NEGATIVE_INFINITY) - (a.change15m ?? Number.NEGATIVE_INFINITY));
		return movers.slice(0, RADAR_MAX);
	}

	needsSeed(): string[] {
		const floor = this.deps.settings().scan.minVolumeUsd24h;
		const out: string[] = [];
		for (const pair of this.deps.universe.all()) {
			if (this.seedListed.has(pair.wsname) || !this.tickers.has(pair.wsname)) continue;
			if (this.volumeUsd24h(pair.wsname) < floor) continue;
			this.seedListed.add(pair.wsname);
			out.push(pair.wsname);
		}
		return out;
	}
}
