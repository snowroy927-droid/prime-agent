import { byClosedAt, isLoss } from "./combo";
import type { Settings } from "./settings";
import type { ClosedTrade } from "./types";

export function consecutiveLosses(closes: readonly ClosedTrade[]): number {
	const sorted = byClosedAt(closes);
	let count = 0;
	for (let i = sorted.length - 1; i >= 0 && isLoss(sorted[i]); i--) count++;
	return count;
}

export function tiltUntil(closes: readonly ClosedTrade[], settings: Settings): number | null {
	if (consecutiveLosses(closes) < settings.tiltLosses) return null;
	const latest = byClosedAt(closes).at(-1);
	return latest ? latest.closedAt + settings.tiltCooldownMin * 60_000 : null;
}
