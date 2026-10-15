import { describe, expect, it } from "vitest";
import { krakenOutcome } from "../src/shared/kraken";
import {
	KRAKEN_TROPHIES,
	peakCumulativeLamports,
	UPGRADES,
	unlockedTrophies,
	unlockedUpgrades,
} from "../src/shared/progression";
import { krakenTrade } from "./helpers/krakenFixtures";
import { closed } from "./helpers/trades";

describe("progression", () => {
	it("keeps upgrades earned at the peak after a drawdown", () => {
		const closes = [
			closed(300_000_000n, 1_000),
			closed(300_000_000n, 2_000),
			closed(-200_000_000n, 3_000),
			closed(-200_000_000n, 4_000),
		];
		expect(peakCumulativeLamports(closes)).toBe(600_000_000n);
		expect(unlockedUpgrades(closes)).toEqual(["neon_sign", "plants_coffee"]);
	});

	it("unlocks nothing while cumulative pnl stays at or below zero", () => {
		expect(peakCumulativeLamports([])).toBe(0n);
		expect(unlockedUpgrades([closed(-50_000_000n, 1_000)])).toEqual([]);
	});

	it("unlocks an upgrade exactly at its threshold and lists all six in order", () => {
		expect(unlockedUpgrades([closed(100_000_000n, 1_000)])).toEqual(["neon_sign"]);
		expect(unlockedUpgrades([closed(10_000_000_000n, 1_000)])).toEqual(UPGRADES.map((u) => u.id));
	});

	it("unlocks INKY trophies exactly at $50, $250 and $1,000 of peak realized USD and keeps them after a loss", () => {
		const outcomes = (...pnls: bigint[]) => pnls.map((pnl, i) => krakenOutcome(krakenTrade(pnl, (i + 1) * 1_000)));
		expect(unlockedTrophies(outcomes(49_999_999n))).toEqual([]);
		expect(unlockedTrophies(outcomes(50_000_000n))).toEqual(["inky_bronze"]);
		expect(unlockedTrophies(outcomes(250_000_000n, -200_000_000n))).toEqual(["inky_bronze", "inky_silver"]);
		expect(unlockedTrophies(outcomes(1_000_000_000n))).toEqual(KRAKEN_TROPHIES.map((trophy) => trophy.id));
	});
});
