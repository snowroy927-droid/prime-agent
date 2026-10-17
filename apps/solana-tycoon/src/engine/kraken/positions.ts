import type { KrakenPosition, KrakenSettings } from "../../shared/kraken";
import type { ExitReason, Mode } from "../../shared/types";
import type { KrakenLot } from "./ledger";

export interface KrakenPositionState {
	id: string;
	mode: Mode;
	pair: string;
	symbol: string;
	openedAt: number;
	costUsdMicros: bigint;
	proceedsUsdMicros: bigint;
	lots: bigint;
	valueUsdMicros: bigint | null;
	pnlPct: number | null;
	peakPnlPct: number;
	price: string | null;
	priceAt: number | null;
	halted: boolean;
	pendingOrder: boolean;
}

export function krakenFromLot(lot: KrakenLot): KrakenPositionState {
	return {
		id: lot.positionId,
		mode: lot.mode,
		pair: lot.pair,
		symbol: lot.symbol,
		openedAt: lot.openedAt,
		costUsdMicros: lot.costUsdMicros,
		proceedsUsdMicros: lot.proceedsUsdMicros,
		lots: lot.lots,
		valueUsdMicros: null,
		pnlPct: null,
		peakPnlPct: 0,
		price: null,
		priceAt: null,
		halted: false,
		pendingOrder: false,
	};
}

// Integer math to 4 decimal places so exit boundaries compare exactly.
function percent(gain: bigint, cost: bigint): number {
	if (cost === 0n) return 0;
	return Number((gain * 1_000_000n) / cost) / 10_000;
}

// `valueUsdMicros` is what selling every lot at the current bid would return after haircut and fee.
export function krakenRevalue(
	p: KrakenPositionState,
	valueUsdMicros: bigint,
	price: string,
	at: number,
): KrakenPositionState {
	const pnlPct = percent(valueUsdMicros + p.proceedsUsdMicros - p.costUsdMicros, p.costUsdMicros);
	return { ...p, valueUsdMicros, pnlPct, peakPnlPct: Math.max(p.peakPnlPct, pnlPct), price, priceAt: at };
}

export function krakenIsStale(p: KrakenPositionState, now: number, s: KrakenSettings): boolean {
	return p.priceAt === null || now - p.priceAt > s.priceStaleSec * 1000;
}

export function evaluateKrakenExit(p: KrakenPositionState, now: number, s: KrakenSettings): ExitReason | null {
	if (p.halted || p.pendingOrder || krakenIsStale(p, now, s) || p.pnlPct === null) return null;
	if (now - p.openedAt >= s.maxHoldMin * 60_000) return "max_hold";
	if (p.pnlPct <= -s.stopLossPct) return "stop_loss";
	if (s.trailingStopPct > 0 && p.peakPnlPct > s.trailingArmPct && p.pnlPct <= p.peakPnlPct - s.trailingStopPct) {
		return "trailing";
	}
	if (p.pnlPct >= s.takeProfitPct) return "take_profit";
	return null;
}

export function krakenToView(p: KrakenPositionState, now: number, s: KrakenSettings): KrakenPosition {
	return {
		id: p.id,
		mode: p.mode,
		pair: p.pair,
		symbol: p.symbol,
		openedAt: p.openedAt,
		costUsdMicros: p.costUsdMicros.toString(),
		proceedsUsdMicros: p.proceedsUsdMicros.toString(),
		lots: p.lots.toString(),
		valueUsdMicros: p.valueUsdMicros === null ? null : p.valueUsdMicros.toString(),
		pnlPct: p.pnlPct,
		peakPnlPct: p.peakPnlPct,
		price: p.price,
		priceAt: p.priceAt,
		stale: krakenIsStale(p, now, s),
		halted: p.halted,
		pendingOrder: p.pendingOrder,
	};
}
