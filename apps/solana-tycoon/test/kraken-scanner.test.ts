import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { BarBook } from "../src/engine/kraken/bars";
import { PairUniverse } from "../src/engine/kraken/pairs";
import type { KrakenRestLike } from "../src/engine/kraken/rest";
import { Scanner } from "../src/engine/kraken/scanner";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const rest: KrakenRestLike = { assetPairs: async () => ({}), ticker: async () => ({}), ohlc: async () => ({}) };

function setup(count: number) {
	const clock = new ManualClock(NOW);
	const universe = new PairUniverse({ rest, clock, settings: () => DEFAULT_KRAKEN_SETTINGS });
	const result: Record<string, unknown> = {};
	for (let i = 0; i < count; i++) {
		result[`C${i}USD`] = {
			altname: `C${i}USD`,
			wsname: `C${i}/USD`,
			quote: "ZUSD",
			pair_decimals: 6,
			lot_decimals: 2,
		};
	}
	universe.apply(result);
	const bars = new BarBook();
	const scanner = new Scanner({
		universe,
		bars,
		clock,
		settings: () => DEFAULT_KRAKEN_SETTINGS,
		held: () => false,
		cooldownUntil: () => null,
		tzOffsetMin: () => 0,
	});
	return { clock, scanner, bars };
}

function tick(scanner: Scanner, wsname: string, price: number, volume24h: number) {
	scanner.onTicker({
		type: "ticker",
		wsname,
		bid: String(price * 0.999),
		ask: String(price * 1.001),
		last: String(price),
		volume24h: String(volume24h),
		vwap24h: String(price),
		at: NOW,
	});
}

describe("Scanner", () => {
	it("ranks pairs above the volume floor by 15-minute change and caps the radar at 50", () => {
		const { scanner, bars } = setup(60);
		for (let i = 0; i < 60; i++) {
			const wsname = `C${i}/USD`;
			bars.seed(wsname, [
				{ begin: NOW - 15 * 60_000, close: 1, volume: 1_000 },
				{ begin: NOW, close: 1 + i / 100, volume: 1_000 },
			]);
			tick(scanner, wsname, 1 + i / 100, i === 59 ? 100 : 1_000_000);
		}
		const movers = scanner.scan();
		expect(movers).toHaveLength(50);
		expect(movers.some((mover) => mover.symbol === "C59")).toBe(false);
		expect(movers[0].symbol).toBe("C58");
		expect(movers[0].change15m).toBeCloseTo(58);
		expect(movers.map((mover) => mover.change15m)).toEqual(
			[...movers.map((mover) => mover.change15m)].sort((a, b) => (b ?? 0) - (a ?? 0)),
		);
	});

	it("lists pairs that need candle seeding once each, only above the volume floor", () => {
		const { scanner } = setup(3);
		tick(scanner, "C0/USD", 1, 1_000_000);
		tick(scanner, "C1/USD", 1, 10);
		expect(scanner.needsSeed()).toEqual(["C0/USD"]);
		expect(scanner.needsSeed()).toEqual([]);
		expect(scanner.quote("C0USD")).toMatchObject({ last: "1", at: NOW });
		expect(scanner.quote("C2USD")).toBeNull();
	});
});
