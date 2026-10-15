import type { Settings } from "../../shared/settings";
import type { ExitReason, Mode, Position } from "../../shared/types";
import type { OpenLot } from "../ledger/ledger";

export interface PositionState {
	id: string;
	mode: Mode;
	mint: string;
	symbol: string;
	openedAt: number;
	costLamports: bigint;
	proceedsLamports: bigint;
	tokenAmount: bigint;
	valueLamports: bigint | null;
	pnlPct: number | null;
	peakPnlPct: number;
	priceSol: number | null;
	priceAt: number | null;
	migrated: boolean;
	pendingOrder: boolean;
}

export function fromLot(lot: OpenLot): PositionState {
	return {
		id: lot.positionId,
		mode: lot.mode,
		mint: lot.mint,
		symbol: lot.symbol,
		openedAt: lot.openedAt,
		costLamports: lot.costLamports,
		proceedsLamports: lot.proceedsLamports,
		tokenAmount: lot.tokenAmount,
		valueLamports: null,
		pnlPct: null,
		peakPnlPct: 0,
		priceSol: null,
		priceAt: null,
		migrated: false,
		pendingOrder: false,
	};
}

// Integer math to 4 decimal places so exit boundaries compare exactly.
function percent(gain: bigint, cost: bigint): number {
	if (cost === 0n) return 0;
	return Number((gain * 1_000_000n) / cost) / 10_000;
}

export function revalue(p: PositionState, valueLamports: bigint, priceSol: number, at: number): PositionState {
	const pnlPct = percent(valueLamports + p.proceedsLamports - p.costLamports, p.costLamports);
	return { ...p, valueLamports, pnlPct, peakPnlPct: Math.max(p.peakPnlPct, pnlPct), priceSol, priceAt: at };
}

export function isStale(p: PositionState, now: number, s: Settings): boolean {
	return p.priceAt === null || now - p.priceAt > s.priceStaleSec * 1000;
}

export function evaluateExit(p: PositionState, now: number, s: Settings): ExitReason | null {
	if (p.pendingOrder || isStale(p, now, s) || p.pnlPct === null) return null;
	if (now - p.openedAt >= s.maxHoldMin * 60_000) return "max_hold";
	if (p.pnlPct <= -s.stopLossPct) return "stop_loss";
	if (s.trailingStopPct > 0 && p.peakPnlPct > 0 && p.pnlPct <= p.peakPnlPct - s.trailingStopPct) return "trailing";
	if (p.pnlPct >= s.takeProfitPct) return "take_profit";
	return null;
}

export function toView(p: PositionState, now: number, s: Settings): Position {
	return {
		id: p.id,
		mode: p.mode,
		mint: p.mint,
		symbol: p.symbol,
		openedAt: p.openedAt,
		costLamports: p.costLamports.toString(),
		tokenAmount: p.tokenAmount.toString(),
		proceedsLamports: p.proceedsLamports.toString(),
		valueLamports: p.valueLamports === null ? null : p.valueLamports.toString(),
		pnlPct: p.pnlPct,
		peakPnlPct: p.peakPnlPct,
		priceSol: p.priceSol,
		priceAt: p.priceAt,
		stale: isStale(p, now, s),
		migrated: p.migrated,
		pendingOrder: p.pendingOrder,
	};
}
