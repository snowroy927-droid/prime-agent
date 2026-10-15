import { z } from "zod";
import type { Outcome } from "./outcome";
import { type PatchResult, parsePatched } from "./settings";
import type { Stats } from "./stats";
import type { ExitReason, FeedStatus, LogLine, Mode, OrderStatus, RiskState, Side } from "./types";

// Amounts: micro-USD decimal strings (`...UsdMicros`); quantities: integer lots at the pair's lot_decimals;
// prices: decimal strings.
export interface KrakenPair {
	pair: string;
	wsname: string;
	symbol: string;
	priceDecimals: number;
	lotDecimals: number;
	ordermin: string | null;
	costmin: string | null;
}

export type RuleStatus =
	| "eligible"
	| "warming_up"
	| "low_volume"
	| "wide_spread"
	| "small_move"
	| "not_rising"
	| "no_volume_surge"
	| "held"
	| "cooldown";

export interface Mover {
	pair: string;
	symbol: string;
	last: string;
	bid: string;
	ask: string;
	change5m: number | null;
	change15m: number | null;
	change60m: number | null;
	volumeUsd24h: number;
	spreadPct: number;
	status: RuleStatus;
	reason: string;
}

export interface KrakenFill {
	id: string;
	positionId: string;
	mode: Mode;
	pair: string;
	symbol: string;
	side: Side;
	usdMicros: string;
	lots: string;
	feesUsdMicros: string;
	ts: number;
}

export interface KrakenClosedTrade {
	positionId: string;
	mode: Mode;
	pair: string;
	symbol: string;
	costUsdMicros: string;
	proceedsUsdMicros: string;
	pnlUsdMicros: string;
	pnlPct: number;
	reason: ExitReason;
	openedAt: number;
	closedAt: number;
}

export interface KrakenPosition {
	id: string;
	mode: Mode;
	pair: string;
	symbol: string;
	openedAt: number;
	costUsdMicros: string;
	proceedsUsdMicros: string;
	lots: string;
	valueUsdMicros: string | null;
	pnlPct: number | null;
	peakPnlPct: number;
	price: string | null;
	priceAt: number | null;
	stale: boolean;
	halted: boolean;
	pendingOrder: boolean;
}

export interface KrakenOrderUpdate {
	id: string;
	positionId: string;
	pair: string;
	symbol: string;
	side: Side;
	status: OrderStatus;
	source: "auto" | "manual" | "exit";
	error?: string;
	at: number;
}

export interface ScanStats {
	moversPerHour: number[];
	skipReasons: { reason: string; count: number }[];
}

export const KRAKEN_HARD_LIMITS = { buyUsdMax: 1000, maxPositionsMax: 10, pinsMax: 6 } as const;

export const KrakenSettingsSchema = z.strictObject({
	buyUsd: z.number().positive(),
	maxPositions: z.number().int().positive(),
	takeProfitPct: z.number().positive(),
	stopLossPct: z.number().positive().max(100),
	trailingStopPct: z.number().min(0).max(100),
	trailingArmPct: z.number().min(0),
	maxHoldMin: z.number().positive(),
	dailyLossCapUsd: z.number().positive(),
	tiltLosses: z.number().int().positive(),
	tiltCooldownMin: z.number().positive(),
	autoBuy: z.boolean(),
	priceStaleSec: z.number().positive(),
	scan: z.strictObject({
		minVolumeUsd24h: z.number().nonnegative(),
		maxSpreadPct: z.number().positive(),
		excludeBases: z.array(z.string()),
	}),
	rule: z.strictObject({
		minChange15mPct: z.number().positive(),
		requireRising5m: z.boolean(),
		volumeSurge: z.number().positive(),
		reentryCooldownMin: z.number().nonnegative(),
	}),
	paper: z.strictObject({
		startingBalanceUsd: z.number().positive(),
		takerFeePct: z.number().min(0).max(10),
		extraSlippageBps: z.number().int().min(0).max(5000),
		latencyMs: z.number().int().nonnegative(),
	}),
});

export type KrakenSettings = z.infer<typeof KrakenSettingsSchema>;

export const DEFAULT_KRAKEN_SETTINGS: KrakenSettings = {
	buyUsd: 50,
	maxPositions: 5,
	takeProfitPct: 6,
	stopLossPct: 3,
	trailingStopPct: 2,
	trailingArmPct: 2,
	maxHoldMin: 120,
	dailyLossCapUsd: 60,
	tiltLosses: 3,
	tiltCooldownMin: 30,
	autoBuy: true,
	priceStaleSec: 10,
	scan: {
		minVolumeUsd24h: 250_000,
		maxSpreadPct: 0.6,
		excludeBases: ["USDT", "USDC", "DAI", "PYUSD", "USDG", "TUSD", "EURC", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"],
	},
	rule: { minChange15mPct: 4, requireRising5m: true, volumeSurge: 2, reentryCooldownMin: 60 },
	paper: { startingBalanceUsd: 1000, takerFeePct: 0.8, extraSlippageBps: 15, latencyMs: 300 },
};

export function applyKrakenSettingsPatch(current: KrakenSettings, patch: unknown): PatchResult<KrakenSettings> {
	const result = parsePatched(KrakenSettingsSchema, current, patch);
	if (!result.ok) return result;
	const settings = result.settings;
	settings.buyUsd = Math.min(settings.buyUsd, KRAKEN_HARD_LIMITS.buyUsdMax);
	settings.maxPositions = Math.min(settings.maxPositions, KRAKEN_HARD_LIMITS.maxPositionsMax);
	return { ok: true, settings };
}

export function krakenOutcome(trade: KrakenClosedTrade): Outcome {
	return { pnl: BigInt(trade.pnlUsdMicros), openedAt: trade.openedAt, closedAt: trade.closedAt, reason: trade.reason };
}

export interface KrakenSnapshot {
	error: string | null;
	feed: { status: FeedStatus; dropped: number; reconnectAt: number | null };
	movers: Mover[];
	positions: KrakenPosition[];
	closes: KrakenClosedTrade[];
	stats: Stats;
	scanStats: ScanStats;
	risk: RiskState;
	settings: KrakenSettings;
	pinned: string[];
	balanceUsdMicros: string;
	solUsd: { price: string; at: number } | null;
}

export type KrakenCommand =
	| { type: "kraken_buy"; id: string; pair: string; holdConfirmed?: boolean }
	| { type: "kraken_sell"; id: string; pair: string; pct: 50 | 100 }
	| { type: "kraken_pin" | "kraken_unpin"; id: string; pair: string }
	| { type: "kraken_pause" | "kraken_resume"; id: string }
	| { type: "kraken_setSettings"; id: string; patch: unknown };

export type KrakenEvent =
	| { type: "kraken_movers"; movers: Mover[] }
	| { type: "kraken_price"; pair: string; bid: string; ask: string; last: string; at: number }
	| { type: "kraken_order"; order: KrakenOrderUpdate }
	| { type: "kraken_position"; position: KrakenPosition }
	| { type: "kraken_close"; trade: KrakenClosedTrade }
	| { type: "kraken_stats"; stats: Stats; scanStats: ScanStats }
	| { type: "kraken_feed"; status: FeedStatus; dropped: number; reconnectAt: number | null }
	| { type: "kraken_risk"; risk: RiskState }
	| { type: "kraken_balance"; usdMicros: string }
	| { type: "kraken_settings"; settings: KrakenSettings }
	| { type: "kraken_pinned"; pairs: string[] }
	| { type: "kraken_sol_usd"; price: string; at: number }
	| { type: "kraken_offline"; error: string }
	| { type: "log"; line: LogLine };
