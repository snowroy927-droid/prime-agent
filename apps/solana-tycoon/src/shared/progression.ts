import { byClosedAt } from "./combo";
import { type Outcome, pumpOutcome } from "./outcome";
import type { ClosedTrade } from "./types";
import { solToLamports } from "./units";

const USD_MICROS = 1_000_000n;

export const UPGRADES = [
	{ id: "neon_sign", atSol: 0.1 },
	{ id: "plants_coffee", atSol: 0.5 },
	{ id: "second_row", atSol: 1 },
	{ id: "trophy_wall", atSol: 2.5 },
	{ id: "space_window", atSol: 5 },
	{ id: "gold_vault", atSol: 10 },
] as const;

export type UpgradeId = (typeof UPGRADES)[number]["id"];

export function peakCumulative(outcomes: readonly Outcome[]): bigint {
	let total = 0n;
	let peak = 0n;
	for (const outcome of byClosedAt(outcomes)) {
		total += outcome.pnl;
		if (total > peak) peak = total;
	}
	return peak;
}

export function peakCumulativeLamports(closes: readonly ClosedTrade[]): bigint {
	return peakCumulative(closes.map(pumpOutcome));
}

export function unlockedUpgrades(closes: readonly ClosedTrade[]): UpgradeId[] {
	const peak = peakCumulativeLamports(closes);
	return UPGRADES.filter((upgrade) => peak >= solToLamports(upgrade.atSol)).map((upgrade) => upgrade.id);
}

// INKY's shelf on the Kraken desk; the office upgrades above stay tied to pump.fun SOL.
export const KRAKEN_TROPHIES = [
	{ id: "inky_bronze", atUsd: 50 },
	{ id: "inky_silver", atUsd: 250 },
	{ id: "inky_gold", atUsd: 1000 },
] as const;

export type KrakenTrophyId = (typeof KRAKEN_TROPHIES)[number]["id"];

export function unlockedTrophies(outcomes: readonly Outcome[]): KrakenTrophyId[] {
	const peak = peakCumulative(outcomes);
	return KRAKEN_TROPHIES.filter((trophy) => peak >= BigInt(trophy.atUsd) * USD_MICROS).map((trophy) => trophy.id);
}
