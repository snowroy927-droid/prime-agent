import { type Outcome, pumpOutcome } from "./outcome";
import type { ClosedTrade } from "./types";

export type TierId = "terminal" | "ice" | "neon" | "gold" | "fever" | "cold";

export const COLD_MS = 20_000;

export function isWin(trade: ClosedTrade): boolean {
	return BigInt(trade.pnlLamports) > 0n;
}

export function isLoss(trade: ClosedTrade): boolean {
	return BigInt(trade.pnlLamports) < 0n;
}

export function byClosedAt<T extends { closedAt: number }>(closes: readonly T[]): T[] {
	return [...closes].sort((a, b) => a.closedAt - b.closedAt);
}

export function comboCountOf(outcomes: readonly Outcome[]): number {
	const sorted = byClosedAt(outcomes);
	let count = 0;
	for (let i = sorted.length - 1; i >= 0 && sorted[i].pnl > 0n; i--) count++;
	return count;
}

export function activeTierOf(outcomes: readonly Outcome[], now: number): TierId {
	const latest = byClosedAt(outcomes).at(-1);
	if (latest && latest.pnl < 0n && now < latest.closedAt + COLD_MS) return "cold";
	const combo = comboCountOf(outcomes);
	if (combo >= 5) return "fever";
	if (combo === 4) return "gold";
	if (combo === 3) return "neon";
	if (combo === 2) return "ice";
	return "terminal";
}

export function comboCount(closes: readonly ClosedTrade[]): number {
	return comboCountOf(closes.map(pumpOutcome));
}

export function activeTier(closes: readonly ClosedTrade[], now: number): TierId {
	return activeTierOf(closes.map(pumpOutcome), now);
}
