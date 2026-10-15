import { byClosedAt } from "./combo";
import { type Outcome, pumpOutcome } from "./outcome";
import type { Settings } from "./settings";
import type { ClosedTrade } from "./types";

export function consecutiveLossesOf(outcomes: readonly Outcome[]): number {
	const sorted = byClosedAt(outcomes);
	let count = 0;
	for (let i = sorted.length - 1; i >= 0 && sorted[i].pnl < 0n; i--) count++;
	return count;
}

export function tiltUntilOf(outcomes: readonly Outcome[], tiltLosses: number, tiltCooldownMin: number): number | null {
	if (consecutiveLossesOf(outcomes) < tiltLosses) return null;
	const latest = byClosedAt(outcomes).at(-1);
	return latest ? latest.closedAt + tiltCooldownMin * 60_000 : null;
}

export function consecutiveLosses(closes: readonly ClosedTrade[]): number {
	return consecutiveLossesOf(closes.map(pumpOutcome));
}

export function tiltUntil(closes: readonly ClosedTrade[], settings: Settings): number | null {
	return tiltUntilOf(closes.map(pumpOutcome), settings.tiltLosses, settings.tiltCooldownMin);
}
