import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FeedStatus } from "../../shared/types";
import type { ChainSource, CurveSnapshot, PoolSnapshot } from "../chain/types";
import type { Clock } from "../clock";
import { toJsonSafe } from "../codec";
import type { KrakenRestLike } from "../kraken/rest";
import type { KrakenEndpoint, RecordingLine } from "./recording";

// Writes the launches, chain reads, and Kraken market data of a live session so it can be replayed offline.
export class Recorder {
	private readonly startedAt: number;
	private globalsWritten = false;
	private krakenStatus: FeedStatus | null = null;

	constructor(
		private readonly path: string,
		private readonly clock: Clock,
	) {
		this.startedAt = clock.now();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "");
		this.write({
			t: 0,
			kind: "meta",
			synthetic: false,
			description: "Recorded session",
			createdAt: new Date(this.startedAt).toISOString(),
		});
	}

	wrapChain(chain: ChainSource): ChainSource {
		return {
			fetchGlobals: async () => {
				const globals = await chain.fetchGlobals();
				if (!this.globalsWritten) {
					this.globalsWritten = true;
					this.write({ t: this.elapsed(), kind: "globals", globals: toJsonSafe(globals) });
				}
				return globals;
			},
			fetchCurve: async (mint) => {
				const snapshot = await chain.fetchCurve(mint);
				if (snapshot) this.curve(snapshot);
				return snapshot;
			},
			watchCurve: (mint, onUpdate) =>
				chain.watchCurve(mint, (snapshot) => {
					this.curve(snapshot);
					onUpdate(snapshot);
				}),
			fetchHolders: async (mint, tokenProgram) => {
				const holders = await chain.fetchHolders(mint, tokenProgram);
				this.write({ t: this.elapsed(), kind: "holders", mint, holders: toJsonSafe(holders) });
				return holders;
			},
			fetchPool: async (mint) => {
				const pool = await chain.fetchPool(mint);
				if (pool) this.pool(pool);
				return pool;
			},
			watchPool: (mint, onUpdate) =>
				chain.watchPool(mint, (snapshot) => {
					this.pool(snapshot);
					onUpdate(snapshot);
				}),
			health: () => chain.health(),
		};
	}

	launchRaw(raw: string): void {
		this.write({ t: this.elapsed(), kind: "launch", raw });
	}

	feedStatus(status: FeedStatus): void {
		this.write({ t: this.elapsed(), kind: "feed", status });
	}

	wrapKrakenRest(rest: KrakenRestLike): KrakenRestLike {
		const recorded = async (endpoint: KrakenEndpoint, query: string, call: Promise<unknown>) => {
			const body = await call;
			this.write({ t: this.elapsed(), kind: "kraken_rest", endpoint, query, body });
			return body;
		};
		return {
			assetPairs: () => recorded("AssetPairs", "", rest.assetPairs()),
			ticker: (pairs) => recorded("Ticker", pairs.join(","), rest.ticker(pairs)),
			ohlc: (pair) => recorded("OHLC", pair, rest.ohlc(pair)),
		};
	}

	krakenRaw(raw: string): void {
		this.write({ t: this.elapsed(), kind: "kraken_ws", raw });
	}

	// The live feed repeats its status to report dropped-message counts; only changes are recorded.
	krakenFeedStatus(status: FeedStatus): void {
		if (status === this.krakenStatus) return;
		this.krakenStatus = status;
		this.write({ t: this.elapsed(), kind: "kraken_feed", status });
	}

	private curve(snapshot: CurveSnapshot): void {
		this.write({ t: this.elapsed(), kind: "curve", mint: snapshot.mint, snap: toJsonSafe(snapshot) });
	}

	private pool(snapshot: PoolSnapshot): void {
		this.write({ t: this.elapsed(), kind: "pool", mint: snapshot.mint, pool: toJsonSafe(snapshot) });
	}

	private elapsed(): number {
		return Math.max(0, this.clock.now() - this.startedAt);
	}

	private write(line: RecordingLine): void {
		appendFileSync(this.path, `${JSON.stringify(line)}\n`);
	}
}
