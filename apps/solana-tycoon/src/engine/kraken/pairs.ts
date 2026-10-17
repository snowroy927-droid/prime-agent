import type { KrakenPair, KrakenSettings } from "../../shared/kraken";
import type { Clock } from "../clock";
import type { KrakenRestLike } from "./rest";

const HOUR_MS = 3_600_000;
const USD_QUOTES = new Set(["ZUSD", "USD"]);

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

// AssetPairs keeps Kraken's legacy codes in wsname (the WebSocket v1 route); WebSocket v2 rejects "XBT/USD" and
// expects "BTC/USD" (docs.kraken.com spot-ws-intro, checked 2026-10-15). XDG -> DOGE follows the same rename and
// is unverified; refused subscriptions are logged so a wrong name shows up on the first live run.
const V2_BASES: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };

// Kraken's AssetPairs fields `wsname`, `ordermin`, `costmin` and `status` are optional here because their
// presence is unverified (spec Section 2); a missing status means tradeable.
export function parseAssetPairs(
	result: unknown,
	excludeBases: readonly string[],
): { pairs: KrakenPair[]; skipped: number } {
	const pairs: KrakenPair[] = [];
	let skipped = 0;
	if (typeof result !== "object" || result === null) return { pairs, skipped };
	const excluded = new Set(excludeBases.map((base) => base.toUpperCase()));
	for (const [key, value] of Object.entries(result)) {
		if (typeof value !== "object" || value === null) {
			skipped++;
			continue;
		}
		const entry = value as Record<string, unknown>;
		const altname = text(entry.altname);
		const wsname = text(entry.wsname);
		const priceDecimals = entry.pair_decimals;
		const lotDecimals = entry.lot_decimals;
		if (
			(altname === null && wsname === null) ||
			typeof priceDecimals !== "number" ||
			typeof lotDecimals !== "number" ||
			!Number.isInteger(priceDecimals) ||
			!Number.isInteger(lotDecimals)
		) {
			skipped++;
			continue;
		}
		const quote = text(entry.quote);
		const isUsd = wsname ? wsname.endsWith("/USD") : quote !== null && USD_QUOTES.has(quote);
		if (!isUsd) continue;
		const status = text(entry.status);
		if (status !== null && status !== "online") continue;
		const legacy = wsname ? wsname.slice(0, -"/USD".length) : (altname ?? "").replace(/Z?USD$/, "");
		const symbol = V2_BASES[legacy] ?? legacy;
		if (symbol === "" || excluded.has(symbol.toUpperCase())) continue;
		pairs.push({
			pair: key,
			wsname: `${symbol}/USD`,
			symbol,
			priceDecimals,
			lotDecimals,
			ordermin: text(entry.ordermin),
			costmin: text(entry.costmin),
		});
	}
	return { pairs, skipped };
}

export class PairUniverse {
	private byKey = new Map<string, KrakenPair>();
	private byWs = new Map<string, KrakenPair>();
	private readonly listeners = new Set<(added: string[], removed: string[]) => void>();

	constructor(private readonly deps: { rest: KrakenRestLike; clock: Clock; settings: () => KrakenSettings }) {}

	async refresh(): Promise<void> {
		this.apply(await this.deps.rest.assetPairs());
	}

	apply(result: unknown): void {
		const { pairs } = parseAssetPairs(result, this.deps.settings().scan.excludeBases);
		const next = new Map(pairs.map((pair) => [pair.pair, pair]));
		const added = [...next.keys()].filter((key) => !this.byKey.has(key));
		const removed = [...this.byKey.keys()].filter((key) => !next.has(key));
		this.byKey = next;
		this.byWs = new Map(pairs.map((pair) => [pair.wsname, pair]));
		if (added.length === 0 && removed.length === 0) return;
		for (const listener of [...this.listeners]) listener(added, removed);
	}

	all(): readonly KrakenPair[] {
		return [...this.byKey.values()];
	}

	byWsName(wsname: string): KrakenPair | undefined {
		return this.byWs.get(wsname);
	}

	byPair(pair: string): KrakenPair | undefined {
		return this.byKey.get(pair);
	}

	onChange(listener: (added: string[], removed: string[]) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	startHourlyRefresh(onError: (error: unknown) => void): () => void {
		return this.deps.clock.every(HOUR_MS, () => {
			this.refresh().catch(onError);
		});
	}
}
