import type { ClosedTrade, ExitReason } from "./types";

// A closed trade reduced to what streaks, tilt, risk and stats need. `pnl` is in the desk's minor units
// (lamports for pump.fun, micro-USD for Kraken).
export interface Outcome {
	pnl: bigint;
	openedAt: number;
	closedAt: number;
	reason: ExitReason;
}

export function pumpOutcome(trade: ClosedTrade): Outcome {
	return { pnl: BigInt(trade.pnlLamports), openedAt: trade.openedAt, closedAt: trade.closedAt, reason: trade.reason };
}
