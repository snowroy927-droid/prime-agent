import type { ClosedTrade } from "../../src/shared/types";

let next = 0;

export function closed(pnlLamports: bigint, closedAt: number): ClosedTrade {
	next += 1;
	const cost = 50_000_000n;
	return {
		positionId: `p${next}`,
		mode: "paper",
		mint: `mint${next}`,
		symbol: `T${next}`,
		costLamports: cost.toString(),
		proceedsLamports: (cost + pnlLamports).toString(),
		pnlLamports: pnlLamports.toString(),
		pnlPct: (Number(pnlLamports) / Number(cost)) * 100,
		reason: pnlLamports > 0n ? "take_profit" : "stop_loss",
		openedAt: closedAt - 60_000,
		closedAt,
	};
}

export const WIN = 10_000_000n;
export const LOSS = -10_000_000n;
