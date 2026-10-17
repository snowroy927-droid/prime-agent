import { describe, expect, it } from "vitest";
import {
	DEFAULT_KRAKEN_SETTINGS,
	type KrakenClosedTrade,
	type KrakenSnapshot,
	krakenOutcome,
	type Mover,
} from "../src/shared/kraken";
import {
	AckSchema,
	CommandSchema,
	type EngineEvent,
	EngineEventSchema,
	type EngineSnapshot,
	PROTOCOL_VERSION,
	ServerMessageSchema,
} from "../src/shared/protocol";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { computeLaunchStats, computeStats, computeStatsOf } from "../src/shared/stats";
import type { CheckResult, Launch, Position } from "../src/shared/types";
import { closed } from "./helpers/trades";

const launch: Launch = {
	mint: "Mint111",
	name: "Zorp Coin",
	symbol: "ZORP",
	creator: "Creator111",
	signature: "Sig111",
	uri: "https://example.com/zorp.json",
	marketCapSol: 28.5,
	receivedAt: 1_000,
};

const check: CheckResult = {
	mint: "Mint111",
	verdict: "approved",
	results: [{ rule: "quote_sol", pass: true, reason: "SOL quote" }],
	reason: "all rules passed",
	checkedAt: 1_500,
	attempt: 1,
};

const position: Position = {
	id: "pos1",
	mode: "paper",
	mint: "Mint111",
	symbol: "ZORP",
	openedAt: 2_000,
	costLamports: "50000000",
	tokenAmount: "1234567890",
	proceedsLamports: "0",
	valueLamports: "61000000",
	pnlPct: 22,
	peakPnlPct: 30,
	priceSol: 0.0000000494,
	priceAt: 2_500,
	stale: false,
	migrated: false,
	pendingOrder: false,
};

function snapshot(): EngineSnapshot {
	const closes = [closed(20_000_000n, 3_000), closed(-5_000_000n, 4_000)];
	return {
		mode: "paper",
		synthetic: false,
		feed: { status: "live", dropped: 0, reconnectAt: null },
		rpc: { publicFallback: true, degraded: false },
		launches: [{ launch, check }],
		positions: [position],
		closes,
		stats: computeStats(closes, 0),
		launchStats: computeLaunchStats([launch], [check], 5_000),
		risk: {
			auto: true,
			paused: false,
			pausedReason: null,
			tiltLosses: 1,
			tiltUntil: null,
			dailyPnl: "15000000",
			dailyCapUntil: null,
		},
		settings: DEFAULT_SETTINGS,
		pinned: ["Mint111"],
		balanceLamports: "1015000000",
		serverTime: 5_000,
		clockRate: 1,
		startedAt: 0,
		kraken: null,
	};
}

const mover: Mover = {
	pair: "MOONUSD",
	symbol: "MOON",
	last: "1.06",
	bid: "1.059",
	ask: "1.061",
	change5m: 1.2,
	change15m: 6,
	change60m: null,
	volumeUsd24h: 1_200_000,
	spreadPct: 0.19,
	status: "eligible",
	reason: "+6.0% in 15m",
};

const krakenTrade: KrakenClosedTrade = {
	positionId: "k1",
	mode: "paper",
	pair: "MOONUSD",
	symbol: "MOON",
	costUsdMicros: "50400000",
	proceedsUsdMicros: "53500000",
	pnlUsdMicros: "3100000",
	pnlPct: 6.15,
	reason: "take_profit",
	openedAt: 2_000,
	closedAt: 3_000,
};

function krakenSnapshot(): KrakenSnapshot {
	return {
		error: null,
		feed: { status: "live", dropped: 3, reconnectAt: null },
		movers: [mover],
		positions: [
			{
				id: "k2",
				mode: "paper",
				pair: "WIDEUSD",
				symbol: "WIDE",
				openedAt: 4_000,
				costUsdMicros: "50400000",
				proceedsUsdMicros: "0",
				lots: "2500",
				valueUsdMicros: null,
				pnlPct: null,
				peakPnlPct: 0,
				price: null,
				priceAt: null,
				stale: true,
				halted: false,
				pendingOrder: false,
			},
		],
		closes: [krakenTrade],
		stats: computeStatsOf([krakenOutcome(krakenTrade)], 0, 1_000_000),
		scanStats: { moversPerHour: Array(24).fill(0), skipReasons: [{ reason: "Wide spread", count: 2 }] },
		risk: {
			auto: true,
			paused: false,
			pausedReason: null,
			tiltLosses: 0,
			tiltUntil: null,
			dailyPnl: "3100000",
			dailyCapUntil: null,
		},
		settings: DEFAULT_KRAKEN_SETTINGS,
		pinned: ["MOONUSD"],
		balanceUsdMicros: "952700000",
		solUsd: { price: "150.25", at: 4_500 },
	};
}

describe("protocol", () => {
	it("round-trips a full snapshot event through JSON", () => {
		const event: EngineEvent = { type: "snapshot", snapshot: snapshot() };
		const parsed = EngineEventSchema.parse(JSON.parse(JSON.stringify(event)));
		expect(parsed).toEqual(event);
	});

	it("round-trips a snapshot with a Kraken section and Kraken events", () => {
		const event: EngineEvent = { type: "snapshot", snapshot: { ...snapshot(), kraken: krakenSnapshot() } };
		expect(EngineEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
		const close: EngineEvent = { type: "kraken_close", trade: krakenTrade };
		expect(EngineEventSchema.parse(close)).toEqual(close);
		expect(EngineEventSchema.parse({ type: "kraken_offline", error: "fetch failed" })).toEqual({
			type: "kraken_offline",
			error: "fetch failed",
		});
	});

	it("caps Kraken movers at 50 per snapshot", () => {
		const kraken = { ...krakenSnapshot(), movers: Array(51).fill(mover) };
		expect(EngineEventSchema.safeParse({ type: "snapshot", snapshot: { ...snapshot(), kraken } }).success).toBe(
			false,
		);
	});

	it("validates Kraken commands", () => {
		expect(CommandSchema.safeParse({ type: "kraken_sell", id: "1", pair: "MOONUSD", pct: 30 }).success).toBe(false);
		expect(CommandSchema.safeParse({ type: "kraken_sell", id: "1", pair: "MOONUSD", pct: 100 }).success).toBe(true);
		expect(CommandSchema.parse({ type: "kraken_buy", id: "2", pair: "MOONUSD" })).toEqual({
			type: "kraken_buy",
			id: "2",
			pair: "MOONUSD",
		});
		expect(CommandSchema.safeParse({ type: "kraken_pin", id: "3", pair: "" }).success).toBe(false);
	});

	it("parses hello and acks as server messages", () => {
		const hello = { type: "hello", protocolVersion: PROTOCOL_VERSION, mode: "demo", synthetic: true };
		expect(ServerMessageSchema.parse(hello)).toEqual(hello);
		expect(AckSchema.parse({ type: "ack", id: "c1", ok: false, error: "paused" }).error).toBe("paused");
	});

	it("rejects a sell outside the allowed percentages", () => {
		expect(CommandSchema.safeParse({ type: "sell", id: "1", mint: "x", pct: 30 }).success).toBe(false);
		expect(CommandSchema.safeParse({ type: "sell", id: "1", mint: "x", pct: 50 }).success).toBe(true);
	});

	it("rejects an unknown command type and a missing id", () => {
		expect(CommandSchema.safeParse({ type: "withdraw", id: "1" }).success).toBe(false);
		expect(CommandSchema.safeParse({ type: "pause" }).success).toBe(false);
	});

	it("accepts snipe without holdConfirmed", () => {
		const parsed = CommandSchema.parse({ type: "snipe", id: "2", mint: "Mint111" });
		expect(parsed).toEqual({ type: "snipe", id: "2", mint: "Mint111" });
	});

	it("rejects lamport fields that are not integer strings", () => {
		const bad = { ...snapshot(), balanceLamports: "1.5" };
		expect(EngineEventSchema.safeParse({ type: "snapshot", snapshot: bad }).success).toBe(false);
	});
});
