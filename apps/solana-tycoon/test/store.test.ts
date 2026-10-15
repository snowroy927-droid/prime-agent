import { describe, expect, it } from "vitest";
import type { EngineEvent, EngineSnapshot } from "../src/shared/protocol";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { computeLaunchStats, computeStats } from "../src/shared/stats";
import type { ClosedTrade, Launch, Position } from "../src/shared/types";
import { initialGameState, reduce, tick } from "../src/web/state/store";
import { closed } from "./helpers/trades";

const NOW = 1_000_000;

function snapshot(over: Partial<EngineSnapshot> = {}): EngineSnapshot {
	return {
		mode: "paper",
		synthetic: false,
		feed: { status: "live", dropped: 0, reconnectAt: null },
		rpc: { publicFallback: false, degraded: false },
		launches: [],
		positions: [],
		closes: [],
		stats: computeStats([], 0),
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
		...over,
	};
}

const launch = (n: number): Launch => ({
	mint: `mint${n}`,
	name: `Coin ${n}`,
	symbol: `C${n}`,
	creator: null,
	signature: null,
	uri: null,
	marketCapSol: 28,
	receivedAt: NOW + n,
});

const position = (over: Partial<Position> = {}): Position => ({
	id: "p1",
	mode: "paper",
	mint: "mint1",
	symbol: "C1",
	openedAt: NOW,
	costLamports: "52544280",
	tokenAmount: "1000",
	proceedsLamports: "0",
	valueLamports: "60000000",
	pnlPct: 14,
	peakPnlPct: 14,
	priceSol: 0.00000003,
	priceAt: NOW,
	stale: false,
	migrated: false,
	pendingOrder: false,
	...over,
});

const apply = (events: EngineEvent[]) => events.reduce(reduce, tick(initialGameState(), NOW));

describe("game store", () => {
	it("starts disconnected and takes the engine snapshot", () => {
		expect(initialGameState()).toMatchObject({
			connection: "connecting",
			snapshot: null,
			combo: 0,
			tier: "terminal",
		});
		const wins: ClosedTrade[] = [closed(1n, NOW - 3_000), closed(1n, NOW - 2_000), closed(1n, NOW - 1_000)];
		const state = apply([{ type: "snapshot", snapshot: snapshot({ closes: wins }) }]);
		expect(state.snapshot?.balanceLamports).toBe("1000000000");
		expect(state.combo).toBe(3);
		expect(state.tier).toBe("neon");
		expect(state.sessionStart).toBe(NOW);
	});

	it("prepends launches and keeps the newest 50", () => {
		const events: EngineEvent[] = [{ type: "snapshot", snapshot: snapshot() }];
		for (let i = 0; i < 55; i++) events.push({ type: "launch", launch: launch(i) });
		const state = apply(events);
		expect(state.snapshot?.launches).toHaveLength(50);
		expect(state.snapshot?.launches[0].launch.symbol).toBe("C54");
	});

	it("attaches a check to its launch and logs the verdict", () => {
		const state = apply([
			{ type: "snapshot", snapshot: snapshot() },
			{ type: "launch", launch: launch(1) },
			{
				type: "check",
				check: {
					mint: "mint1",
					verdict: "rejected",
					results: [{ rule: "blocklist", pass: false, reason: 'Name contains "rug"' }],
					reason: 'Name contains "rug"',
					checkedAt: NOW + 2_000,
					attempt: 1,
				},
			},
		]);
		expect(state.snapshot?.launches[0].check?.verdict).toBe("rejected");
		expect(state.log.at(-1)?.message).toBe('VERA: C1 rejected - Name contains "rug"');
	});

	it("upserts positions", () => {
		const state = apply([
			{ type: "snapshot", snapshot: snapshot() },
			{ type: "position", position: position() },
			{ type: "position", position: position({ pnlPct: 40 }) },
		]);
		expect(state.snapshot?.positions).toHaveLength(1);
		expect(state.snapshot?.positions[0].pnlPct).toBe(40);
	});

	it("closes a position, appends the trade, and recomputes combo and tier", () => {
		const first = closed(10_000_000n, NOW + 1_000);
		const second = { ...closed(20_000_000n, NOW + 2_000), positionId: "p1" };
		const state = apply([
			{ type: "snapshot", snapshot: snapshot({ closes: [first] }) },
			{ type: "position", position: position() },
			{ type: "close", trade: second },
		]);
		expect(state.snapshot?.positions).toEqual([]);
		expect(state.snapshot?.closes.at(-1)).toEqual(second);
		expect(state.combo).toBe(2);
		expect(state.tier).toBe("ice");
		expect(state.upgrades).toEqual([]);
	});

	it("tracks feed status, risk, balance, settings, and pins", () => {
		const state = apply([
			{ type: "snapshot", snapshot: snapshot() },
			{ type: "feed", status: "down", dropped: 2, reconnectAt: NOW + 4_000 },
			{ type: "balance", lamports: "5" },
			{ type: "pinned", mints: ["mint9"] },
			{ type: "settings", settings: { ...DEFAULT_SETTINGS, buySol: 0.02 } },
		]);
		expect(state.snapshot?.feed).toEqual({ status: "down", dropped: 2, reconnectAt: NOW + 4_000 });
		expect(state.snapshot?.balanceLamports).toBe("5");
		expect(state.snapshot?.pinned).toEqual(["mint9"]);
		expect(state.snapshot?.settings.buySol).toBe(0.02);
	});

	it("turns cold back to terminal 20 seconds after a loss", () => {
		const loss = closed(-1n, NOW + 1_000);
		const cold = apply([{ type: "snapshot", snapshot: snapshot({ closes: [loss] }) }]);
		const at5 = tick(cold, NOW + 6_000);
		expect(at5.tier).toBe("cold");
		expect(tick(at5, NOW + 21_001).tier).toBe("terminal");
	});

	it("ignores stream events until a snapshot arrives", () => {
		const state = reduce(initialGameState(), { type: "launch", launch: launch(1) });
		expect(state.snapshot).toBeNull();
	});
});
