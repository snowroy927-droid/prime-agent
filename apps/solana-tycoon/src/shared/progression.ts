import { byClosedAt } from "./combo";
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

export function peakCumulativeLamports(closes: readonly ClosedTrade[]): bigint {
	let total = 0n;
	let peak = 0n;
	for (const trade of byClosedAt(closes)) {
		total += BigInt(trade.pnlLamports);
		if (total > peak) peak = total;
	}
	return peak;
}

export function unlockedUpgrades(closes: readonly ClosedTrade[]): UpgradeId[] {
	const peak = peakCumulativeLamports(closes);
	return UPGRADES.filter((upgrade) => peak >= solToLamports(upgrade.atSol)).map((upgrade) => upgrade.id);
}
