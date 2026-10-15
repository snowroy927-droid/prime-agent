import { describe, expect, it } from "vitest";
import type { EngineEvent, EngineSnapshot } from "../src/shared/protocol";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { computeLaunchStats, computeStats } from "../src/shared/stats";
import type { CheckResult, ClosedTrade, OrderUpdate, Position } from "../src/shared/types";
import { ceoMood, type Reaction, reactionsFor } from "../src/web/scene/director";
import { type GameState, initialGameState, reduce } from "../src/web/state/store";
import { closed } from "./helpers/trades";

const NOW = 5_000_000;

function snapshot(closes: ClosedTrade[] = []): EngineSnapshot {
	return {
		mode: "paper",
		synthetic: false,
		feed: { status: "live", dropped: 0, reconnectAt: null },
		rpc: { publicFallback: false, degraded: false },
		launches: [],
		positions: [],
		closes,
		stats: computeStats(closes, 0),
		launchStats: computeLaunchStats([], [], NOW),
		risk: {
			autoSnipe: true,
			paused: false,
			pausedReason: null,
			tiltLosses: 0,
			tiltUntil: null,
			dailyPnlLamports: "0",
			dailyCapUntil: null,
		},
		settings: DEFAULT_SETTINGS,
		pinned: [],
		balanceLamports: "1000000000",
		serverTime: NOW,
		clockRate: 1,
	};
}

function stateWith(closes: ClosedTrade[] = []): GameState {
	return reduce({ ...initialGameState(), now: NOW }, { type: "snapshot", snapshot: snapshot(closes) });
}

function step(prev: GameState, event: EngineEvent): Reaction[] {
	return reactionsFor(prev, reduce(prev, event), event);
}

const check = (verdict: CheckResult["verdict"], reason: string): CheckResult => ({
	mint: "m1",
	verdict,
	results: [],
	reason,
	checkedAt: NOW,
	attempt: 1,
});

const order = (status: OrderUpdate["status"], over: Partial<OrderUpdate> = {}): OrderUpdate => ({
	id: "o1",
	positionId: "p1",
	mint: "m1",
	symbol: "ZORP",
	side: "buy",
	status,
	source: "auto",
	at: NOW,
	...over,
});

const wins = (n: number) => Array.from({ length: n }, (_, i) => closed(1_000n, NOW - 10_000 + i));
const win = () => closed(5_000_000n, NOW + 1);

describe("reactionsFor", () => {
	it("hops ZORP and blips on a launch", () => {
		const reactions = step(stateWith(), {
			type: "launch",
			launch: {
				mint: "m1",
				name: "Zorp",
				symbol: "ZORP",
				creator: null,
				signature: null,
				uri: null,
				marketCapSol: 28,
				receivedAt: NOW,
			},
		});
		expect(reactions).toEqual([{ cast: "zorp", state: "celebrate", ms: 1200 }, { sfx: "launch" }]);
	});

	it("stamps VERA approved", () => {
		expect(step(stateWith(), { type: "check", check: check("approved", "All checks passed") })).toEqual([
			{ cast: "vera", state: "celebrate", ms: 2500, bubble: "APPROVED" },
			{ sfx: "approve" },
		]);
	});

	it("alarms VERA and ZORP on a rejection with the reason", () => {
		expect(step(stateWith(), { type: "check", check: check("rejected", 'Name contains "rug"') })).toEqual([
			{ cast: "vera", state: "alarm", ms: 2500, bubble: 'Name contains "rug"' },
			{ cast: "zorp", state: "alarm", ms: 2000 },
			{ sfx: "reject" },
		]);
	});

	it("does nothing for pending or unchecked checks", () => {
		expect(step(stateWith(), { type: "check", check: check("unchecked", "RPC budget exhausted") })).toEqual([]);
	});

	it("puts ZORP to sleep while the feed is down and wakes him when it is live", () => {
		expect(step(stateWith(), { type: "feed", status: "down", dropped: 0, reconnectAt: null })).toEqual([
			{ cast: "zorp", state: "sleep", ms: 0 },
		]);
		expect(step(stateWith(), { type: "feed", status: "live", dropped: 0, reconnectAt: null })).toEqual([
			{ cast: "zorp", state: "idle", ms: 0 },
		]);
	});

	it("keeps REX typing while an order is pending", () => {
		expect(step(stateWith(), { type: "order", order: order("pending") })).toEqual([
			{ cast: "rex", state: "work", ms: 0 },
		]);
	});

	it("celebrates a fill and returns REX to idle when nothing else is pending", () => {
		const pending = reduce(stateWith(), { type: "order", order: order("pending") });
		expect(step(pending, { type: "order", order: order("filled") })).toEqual([
			{ cast: "rex", state: "idle", ms: 0 },
			{ cast: "rex", state: "celebrate", ms: 1500 },
			{ sfx: "fill" },
		]);
	});

	it("keeps REX working when another order is still pending", () => {
		let state = reduce(stateWith(), { type: "order", order: order("pending") });
		state = reduce(state, { type: "order", order: order("pending", { id: "o2", mint: "m2" }) });
		expect(step(state, { type: "order", order: order("filled") })[0]).toEqual({ cast: "rex", state: "work", ms: 0 });
	});

	it("shows REX's facepalm with the error on a failed order", () => {
		const pending = reduce(stateWith(), { type: "order", order: order("pending") });
		expect(step(pending, { type: "order", order: order("failed", { error: "Coin migrated before fill" }) })).toEqual([
			{ cast: "rex", state: "idle", ms: 0 },
			{ cast: "rex", state: "fail", ms: 2000, bubble: "Coin migrated before fill" },
		]);
	});

	it("has GLOOP count coins on a first win with no combo effects", () => {
		expect(step(stateWith(), { type: "close", trade: win() })).toEqual([
			{ cast: "gloop", state: "celebrate", ms: 2000 },
		]);
	});

	it("shows the COMBO x2 banner going from 1 to 2", () => {
		const reactions = step(stateWith(wins(1)), { type: "close", trade: win() });
		expect(reactions).toContainEqual({ effect: "banner", text: "COMBO x2" });
		expect(reactions).toContainEqual({ sfx: "combo" });
		expect(reactions.some((r) => "effect" in r && r.effect === "coins")).toBe(false);
	});

	it("throws coins and shakes at x3, and gets everyone dancing at x4", () => {
		const x3 = step(stateWith(wins(2)), { type: "close", trade: win() });
		expect(x3).toContainEqual({ effect: "coins", count: 40 });
		expect(x3).toContainEqual({ effect: "shake", px: 2, ms: 400 });
		const x4 = step(stateWith(wins(3)), { type: "close", trade: win() });
		for (const cast of ["zorp", "vera", "rex", "gloop", "ceo"] as const) {
			expect(x4).toContainEqual({ cast, state: "dance", ms: 3000 });
		}
	});

	it("goes FEVER from 4 to 5", () => {
		const reactions = step(stateWith(wins(4)), { type: "close", trade: win() });
		expect(reactions).toContainEqual({ effect: "confetti", count: 120 });
		expect(reactions).toContainEqual({ effect: "shake", px: 4, ms: 600 });
		expect(reactions).toContainEqual({ sfx: "fever" });
		expect(reactions).toContainEqual({ cast: "ceo", state: "dance", ms: 0 });
		expect(reactions).toContainEqual({ effect: "banner", text: "COMBO x5" });
	});

	it("makes GLOOP sweat on a loss", () => {
		expect(step(stateWith(wins(3)), { type: "close", trade: closed(-2_000_000n, NOW + 1) })).toEqual([
			{ cast: "gloop", state: "sweat", ms: 2500 },
			{ sfx: "loss" },
		]);
	});
});

describe("ceoMood", () => {
	const withPosition = (value: string): GameState => {
		const state = stateWith();
		const position: Position = {
			id: "p1",
			mode: "paper",
			mint: "m1",
			symbol: "ZORP",
			openedAt: NOW,
			costLamports: "100000000",
			tokenAmount: "1",
			proceedsLamports: "0",
			valueLamports: value,
			pnlPct: 0,
			peakPnlPct: 0,
			priceSol: 1,
			priceAt: NOW,
			stale: false,
			migrated: false,
			pendingOrder: false,
		};
		return reduce(state, { type: "position", position });
	};

	it("follows session PnL and dances in FEVER", () => {
		expect(ceoMood(stateWith())).toBe("idle");
		expect(ceoMood(withPosition("120000000"))).toBe("celebrate");
		expect(ceoMood(withPosition("40000000"))).toBe("sweat");
		expect(ceoMood({ ...stateWith(), tier: "fever" })).toBe("dance");
	});
});
