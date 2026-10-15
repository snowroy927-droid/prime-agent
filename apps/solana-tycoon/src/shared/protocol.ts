import { z } from "zod";
import { SettingsSchema } from "./settings";
import type { LaunchStats, Stats } from "./stats";
import type {
	CheckResult,
	ClosedTrade,
	Fill,
	Launch,
	LogLine,
	OrderUpdate,
	Position,
	PriceTick,
	RiskState,
	RuleResult,
} from "./types";

export const PROTOCOL_VERSION = 2;

export const LamportsSchema = z.string().regex(/^-?\d+$/, "expected an integer string");

export const ModeSchema = z.enum(["paper", "live", "replay", "demo"]);
export const FeedStatusSchema = z.enum(["connecting", "live", "down"]);
export const RuleIdSchema = z.enum([
	"quote_sol",
	"not_mayhem",
	"curve_live",
	"blocklist",
	"serial_launcher",
	"top_holder",
	"holder_spread",
	"min_real_sol",
]);
export const VerdictSchema = z.enum(["pending", "approved", "rejected", "unchecked"]);
export const SideSchema = z.enum(["buy", "sell"]);
export const ExitReasonSchema = z.enum(["take_profit", "stop_loss", "trailing", "manual", "kill", "max_hold"]);
export const OrderStatusSchema = z.enum(["pending", "filled", "failed"]);

export const LaunchSchema = z.object({
	mint: z.string(),
	name: z.string(),
	symbol: z.string(),
	creator: z.string().nullable(),
	signature: z.string().nullable(),
	uri: z.string().nullable(),
	marketCapSol: z.number().nullable(),
	receivedAt: z.number(),
}) satisfies z.ZodType<Launch>;

export const RuleResultSchema = z.object({
	rule: RuleIdSchema,
	pass: z.boolean(),
	reason: z.string(),
}) satisfies z.ZodType<RuleResult>;

export const CheckResultSchema = z.object({
	mint: z.string(),
	verdict: VerdictSchema,
	results: z.array(RuleResultSchema),
	reason: z.string(),
	checkedAt: z.number(),
	attempt: z.number().int(),
}) satisfies z.ZodType<CheckResult>;

export const PriceTickSchema = z.object({
	mint: z.string(),
	priceSol: z.number(),
	marketCapSol: z.number(),
	source: z.enum(["curve", "pool"]),
	at: z.number(),
}) satisfies z.ZodType<PriceTick>;

export const FillSchema = z.object({
	id: z.string(),
	positionId: z.string(),
	mode: ModeSchema,
	mint: z.string(),
	symbol: z.string(),
	side: SideSchema,
	solLamports: LamportsSchema,
	tokenAmount: LamportsSchema,
	feesLamports: LamportsSchema,
	signature: z.string().optional(),
	ts: z.number(),
}) satisfies z.ZodType<Fill>;

export const ClosedTradeSchema = z.object({
	positionId: z.string(),
	mode: ModeSchema,
	mint: z.string(),
	symbol: z.string(),
	costLamports: LamportsSchema,
	proceedsLamports: LamportsSchema,
	pnlLamports: LamportsSchema,
	pnlPct: z.number(),
	reason: ExitReasonSchema,
	openedAt: z.number(),
	closedAt: z.number(),
}) satisfies z.ZodType<ClosedTrade>;

export const PositionSchema = z.object({
	id: z.string(),
	mode: ModeSchema,
	mint: z.string(),
	symbol: z.string(),
	openedAt: z.number(),
	costLamports: LamportsSchema,
	tokenAmount: LamportsSchema,
	proceedsLamports: LamportsSchema,
	valueLamports: LamportsSchema.nullable(),
	pnlPct: z.number().nullable(),
	peakPnlPct: z.number(),
	priceSol: z.number().nullable(),
	priceAt: z.number().nullable(),
	stale: z.boolean(),
	migrated: z.boolean(),
	pendingOrder: z.boolean(),
}) satisfies z.ZodType<Position>;

export const OrderUpdateSchema = z.object({
	id: z.string(),
	positionId: z.string(),
	mint: z.string(),
	symbol: z.string(),
	side: SideSchema,
	status: OrderStatusSchema,
	source: z.enum(["auto", "manual", "exit"]),
	error: z.string().optional(),
	at: z.number(),
}) satisfies z.ZodType<OrderUpdate>;

export const RiskStateSchema = z.object({
	auto: z.boolean(),
	paused: z.boolean(),
	pausedReason: z.string().nullable(),
	tiltLosses: z.number().int(),
	tiltUntil: z.number().nullable(),
	dailyPnl: LamportsSchema,
	dailyCapUntil: z.number().nullable(),
}) satisfies z.ZodType<RiskState>;

export const LogLineSchema = z.object({
	level: z.enum(["info", "warn", "error"]),
	message: z.string(),
	at: z.number(),
}) satisfies z.ZodType<LogLine>;

export const StatsSchema = z.object({
	trades: z.number().int(),
	wins: z.number().int(),
	losses: z.number().int(),
	winRate: z.number(),
	avgWin: z.number(),
	avgLoss: z.number(),
	profitFactor: z.number().nullable(),
	expectancy: z.number(),
	expectancyCi90: z.tuple([z.number(), z.number()]).nullable(),
	best: z.number().nullable(),
	worst: z.number().nullable(),
	realized: z.number(),
	cumulative: z.array(z.object({ at: z.number(), value: z.number() })),
	pnlByHour: z.array(z.number()),
	holds: z.array(z.object({ holdSec: z.number(), pnl: z.number() })),
	exitReasons: z.record(ExitReasonSchema, z.number().int()),
	verdict: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("collecting"), needed: z.number().int() }),
		z.object({ kind: z.literal("losing") }),
		z.object({ kind: z.literal("not_losing") }),
	]),
}) satisfies z.ZodType<Stats>;

export const LaunchStatsSchema = z.object({
	perHour: z.array(z.number().int()),
	checked: z.number().int(),
	approved: z.number().int(),
	passRate: z.number(),
	topRejections: z.array(z.object({ rule: RuleIdSchema, count: z.number().int() })),
}) satisfies z.ZodType<LaunchStats>;

const FeedStateShape = {
	status: FeedStatusSchema,
	dropped: z.number().int().nonnegative(),
	reconnectAt: z.number().nullable(),
};

export const EngineSnapshotSchema = z.object({
	mode: ModeSchema,
	synthetic: z.boolean(),
	feed: z.object(FeedStateShape),
	rpc: z.object({ publicFallback: z.boolean(), degraded: z.boolean() }),
	launches: z.array(z.object({ launch: LaunchSchema, check: CheckResultSchema.nullable() })).max(50),
	positions: z.array(PositionSchema),
	closes: z.array(ClosedTradeSchema).max(500),
	stats: StatsSchema,
	launchStats: LaunchStatsSchema,
	risk: RiskStateSchema,
	settings: SettingsSchema,
	pinned: z.array(z.string()),
	balanceLamports: LamportsSchema,
	serverTime: z.number(),
	// Engine milliseconds per wall-clock millisecond: the replay speed in demo and replay, otherwise 1.
	clockRate: z.number().positive(),
	// When this engine process started, on the engine clock; session PnL counts from here.
	startedAt: z.number(),
});

export const EngineEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		protocolVersion: z.number().int(),
		mode: ModeSchema,
		synthetic: z.boolean(),
	}),
	z.object({ type: z.literal("snapshot"), snapshot: EngineSnapshotSchema }),
	z.object({ type: z.literal("launch"), launch: LaunchSchema }),
	z.object({ type: z.literal("check"), check: CheckResultSchema }),
	z.object({ type: z.literal("price"), tick: PriceTickSchema }),
	z.object({ type: z.literal("order"), order: OrderUpdateSchema }),
	z.object({ type: z.literal("position"), position: PositionSchema }),
	z.object({ type: z.literal("close"), trade: ClosedTradeSchema }),
	z.object({ type: z.literal("stats"), stats: StatsSchema, launchStats: LaunchStatsSchema }),
	z.object({ type: z.literal("feed"), ...FeedStateShape }),
	z.object({ type: z.literal("risk"), risk: RiskStateSchema }),
	z.object({ type: z.literal("balance"), lamports: LamportsSchema }),
	z.object({ type: z.literal("settings"), settings: SettingsSchema }),
	z.object({ type: z.literal("pinned"), mints: z.array(z.string()) }),
	z.object({ type: z.literal("log"), line: LogLineSchema }),
]);

const CommandId = z.string().min(1);
const Mint = z.string().min(1);

export const CommandSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("snipe"), id: CommandId, mint: Mint, holdConfirmed: z.boolean().optional() }),
	z.object({ type: z.literal("sell"), id: CommandId, mint: Mint, pct: z.union([z.literal(50), z.literal(100)]) }),
	z.object({ type: z.literal("pin"), id: CommandId, mint: Mint }),
	z.object({ type: z.literal("unpin"), id: CommandId, mint: Mint }),
	z.object({ type: z.literal("pause"), id: CommandId }),
	z.object({ type: z.literal("resume"), id: CommandId }),
	z.object({ type: z.literal("kill"), id: CommandId }),
	z.object({ type: z.literal("setSettings"), id: CommandId, patch: z.unknown() }),
]);

export const AckSchema = z.object({
	type: z.literal("ack"),
	id: z.string(),
	ok: z.boolean(),
	error: z.string().optional(),
});

export const ServerMessageSchema = z.union([EngineEventSchema, AckSchema]);

export type EngineSnapshot = z.infer<typeof EngineSnapshotSchema>;
export type EngineEvent = z.infer<typeof EngineEventSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Ack = z.infer<typeof AckSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, "id">;
