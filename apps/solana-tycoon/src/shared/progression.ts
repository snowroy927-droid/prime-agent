import { byClosedAt } from "./combo";
import { type Outcome, pumpOutcome } from "./outcome";
import type { ClosedTrade } from "./types";
import { solToLamports } from "./units";

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
