import type { ClosedTrade } from "./types";

export type TierId = "terminal" | "ice" | "neon" | "gold" | "fever" | "cold";

export const COLD_MS = 20_000;

export function isWin(trade: ClosedTrade): boolean {
	return BigInt(trade.pnlLamports) > 0n;
}

export function isLoss(trade: ClosedTrade): boolean {
	return BigInt(trade.pnlLamports) < 0n;
}

export function byClosedAt(closes: readonly ClosedTrade[]): ClosedTrade[] {
	return [...closes].sort((a, b) => a.closedAt - b.closedAt);
}

export function comboCount(closes: readonly ClosedTrade[]): number {
	const sorted = byClosedAt(closes);
	let count = 0;
	for (let i = sorted.length - 1; i >= 0 && isWin(sorted[i]); i--) count++;
	return count;
}

export function activeTier(closes: readonly ClosedTrade[], now: number): TierId {
	const latest = byClosedAt(closes).at(-1);
	if (latest && isLoss(latest) && now < latest.closedAt + COLD_MS) return "cold";
	const combo = comboCount(closes);
	if (combo >= 5) return "fever";
	if (combo === 4) return "gold";
	if (combo === 3) return "neon";
	if (combo === 2) return "ice";
	return "terminal";
}
