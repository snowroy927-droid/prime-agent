const MAX_DELAY_MS = 30_000;

// unit is a uniform random number in [0, 1) that spreads the delay over 0.8x-1.2x.
export function backoffDelay(attempt: number, unit: number, baseMs = 1_000): number {
	return Math.min(MAX_DELAY_MS, baseMs * 2 ** attempt) * (0.8 + 0.4 * unit);
}
