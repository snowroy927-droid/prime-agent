import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { PairUniverse, parseAssetPairs } from "../src/engine/kraken/pairs";
import type { KrakenRestLike } from "../src/engine/kraken/rest";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";

const FIXTURE: Record<string, unknown> = {
	PEPEUSD: {
		altname: "PEPEUSD",
		wsname: "PEPE/USD",
		base: "PEPE",
		quote: "ZUSD",
		pair_decimals: 9,
		lot_decimals: 0,
		ordermin: "1000000",
		costmin: "0.5",
		status: "online",
	},
	PEPEEUR: { altname: "PEPEEUR", wsname: "PEPE/EUR", quote: "ZEUR", pair_decimals: 9, lot_decimals: 0 },
	HALTUSD: {
		altname: "HALTUSD",
		wsname: "HALT/USD",
		quote: "ZUSD",
		pair_decimals: 4,
		lot_decimals: 2,
		status: "cancel_only",
	},
	USDTZUSD: { altname: "USDTZUSD", wsname: "USDT/USD", quote: "ZUSD", pair_decimals: 4, lot_decimals: 2 },
	WIFUSD: { altname: "WIFUSD", quote: "ZUSD", pair_decimals: 5, lot_decimals: 5 },
	BROKEN: { altname: 7 },
};

describe("parseAssetPairs", () => {
	it("keeps tradeable USD pairs, drops stablecoins and other quotes, and counts malformed entries", () => {
		const { pairs, skipped } = parseAssetPairs(FIXTURE, DEFAULT_KRAKEN_SETTINGS.scan.excludeBases);
		expect(pairs).toEqual([
			{
				pair: "PEPEUSD",
				wsname: "PEPE/USD",
				symbol: "PEPE",
				priceDecimals: 9,
				lotDecimals: 0,
				ordermin: "1000000",
				costmin: "0.5",
			},
			{
				pair: "WIFUSD",
				wsname: "WIF/USD",
				symbol: "WIF",
				priceDecimals: 5,
				lotDecimals: 5,
				ordermin: null,
				costmin: null,
			},
		]);
		expect(skipped).toBe(1);
	});
});

describe("PairUniverse", () => {
	it("reports pairs that disappear on refresh", async () => {
		const clock = new ManualClock(0);
		const results = [FIXTURE, { PEPEUSD: FIXTURE.PEPEUSD }];
		const rest: KrakenRestLike = {
			assetPairs: async () => results.shift(),
			ticker: async () => ({}),
			ohlc: async () => ({}),
		};
		const universe = new PairUniverse({ rest, clock, settings: () => DEFAULT_KRAKEN_SETTINGS });
		const changes: [string[], string[]][] = [];
		universe.onChange((added, removed) => changes.push([added, removed]));
		await universe.refresh();
		expect(universe.all().map((pair) => pair.pair)).toEqual(["PEPEUSD", "WIFUSD"]);
		expect(universe.byWsName("WIF/USD")?.pair).toBe("WIFUSD");
		await universe.refresh();
		expect(universe.byPair("WIFUSD")).toBeUndefined();
		expect(changes).toEqual([
			[["PEPEUSD", "WIFUSD"], []],
			[[], ["WIFUSD"]],
		]);
	});
});
