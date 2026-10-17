import type { KrakenFeedEvent, KrakenFeedLike } from "../../src/engine/kraken/feed";
import type { KrakenRestLike } from "../../src/engine/kraken/rest";

export class FakeKrakenFeed implements KrakenFeedLike {
	symbols: string[] = [];
	started = false;
	private readonly listeners = new Set<(event: KrakenFeedEvent) => void>();

	setSymbols(wsnames: readonly string[]): void {
		this.symbols = [...wsnames];
	}

	// Like KrakenFeed once its socket opens.
	start(): void {
		this.started = true;
		this.emit({ type: "status", status: "live", dropped: 0, reconnectAt: null });
	}

	stop(): void {
		this.started = false;
	}

	on(listener: (event: KrakenFeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: KrakenFeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}

export class FakeKrakenRest implements KrakenRestLike {
	pairs: Record<string, unknown> = {};
	assetPairsError: Error | null = null;
	// While set, the pair list does not answer (a hung connection).
	assetPairsHang: Promise<void> | null = null;
	candles = new Map<string, unknown[][]>();
	ohlcError: Error | null = null;
	ohlcCalls: string[] = [];

	async assetPairs(): Promise<unknown> {
		if (this.assetPairsHang) await this.assetPairsHang;
		if (this.assetPairsError) throw this.assetPairsError;
		return structuredClone(this.pairs);
	}

	async ticker(): Promise<unknown> {
		return {};
	}

	async ohlc(pair: string): Promise<unknown> {
		this.ohlcCalls.push(pair);
		if (this.ohlcError) throw this.ohlcError;
		return { [pair]: this.candles.get(pair) ?? [], last: 0 };
	}
}

export const usdPair = (symbol: string, priceDecimals = 6, lotDecimals = 2) => ({
	altname: `${symbol}USD`,
	wsname: `${symbol}/USD`,
	quote: "ZUSD",
	pair_decimals: priceDecimals,
	lot_decimals: lotDecimals,
});
