export type Mode = "paper" | "live" | "replay" | "demo";
export type FeedStatus = "connecting" | "live" | "down";
export interface Launch {
	mint: string;
	name: string;
	symbol: string;
	creator: string | null;
	signature: string | null;
	uri: string | null;
	marketCapSol: number | null;
	receivedAt: number;
}
export type RuleId =
	| "quote_sol"
	| "not_mayhem"
	| "curve_live"
	| "blocklist"
	| "serial_launcher"
	| "top_holder"
	| "holder_spread"
	| "min_real_sol";
export interface RuleResult {
	rule: RuleId;
	pass: boolean;
	reason: string;
}
export type Verdict = "pending" | "approved" | "rejected" | "unchecked";
export interface CheckResult {
	mint: string;
	verdict: Verdict;
	results: RuleResult[];
	reason: string;
	checkedAt: number;
	attempt: number;
}
export interface PriceTick {
	mint: string;
	priceSol: number;
	marketCapSol: number;
	source: "curve" | "pool";
	at: number;
}
export type Side = "buy" | "sell";
export interface Fill {
	id: string;
	positionId: string;
	mode: Mode;
	mint: string;
	symbol: string;
	side: Side;
	solLamports: string;
	tokenAmount: string;
	feesLamports: string;
	signature?: string;
	ts: number;
}
export type ExitReason = "take_profit" | "stop_loss" | "trailing" | "manual" | "kill" | "max_hold";
export interface ClosedTrade {
	positionId: string;
	mode: Mode;
	mint: string;
	symbol: string;
	costLamports: string;
	proceedsLamports: string;
	pnlLamports: string;
	pnlPct: number;
	reason: ExitReason;
	openedAt: number;
	closedAt: number;
}
export interface Position {
	id: string;
	mode: Mode;
	mint: string;
	symbol: string;
	openedAt: number;
	costLamports: string;
	tokenAmount: string;
	proceedsLamports: string;
	valueLamports: string | null;
	pnlPct: number | null;
	peakPnlPct: number;
	priceSol: number | null;
	priceAt: number | null;
	stale: boolean;
	migrated: boolean;
	pendingOrder: boolean;
}
export type OrderStatus = "pending" | "filled" | "failed";
export interface OrderUpdate {
	id: string;
	positionId: string;
	mint: string;
	symbol: string;
	side: Side;
	status: OrderStatus;
	source: "auto" | "manual" | "exit";
	error?: string;
	at: number;
}
// dailyPnl is a decimal string in the desk's minor units (lamports or micro-USD).
export interface RiskState {
	auto: boolean;
	paused: boolean;
	pausedReason: string | null;
	tiltLosses: number;
	tiltUntil: number | null;
	dailyPnl: string;
	dailyCapUntil: number | null;
}
export interface LogLine {
	level: "info" | "warn" | "error";
	message: string;
	at: number;
}
