import { beforeEach, describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import {
	dailyPnl,
	defaultTzOffsetMin,
	nextLocalMidnight,
	PUMP_RISK_COPY,
	pumpLimits,
	RiskGuard,
} from "../src/engine/risk/guard";
import { type Outcome, pumpOutcome } from "../src/shared/outcome";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";
import { closed as closedTrade } from "./helpers/trades";

const CDT = -300;
const MIN = 60_000;
// 23:30 local on 14 October in US Central daylight time.
const NOW = Date.UTC(2026, 9, 15, 4, 30);
const LOCAL_MIDNIGHT = Date.UTC(2026, 9, 15, 5, 0);

let clock: ManualClock;
let settings: Settings;
let guard: RiskGuard;

const approved = { holdConfirmed: false, signal: "approved" as const };
const closed = (pnl: bigint, at: number): Outcome => pumpOutcome(closedTrade(pnl, at));

beforeEach(() => {
	clock = new ManualClock(NOW);
	settings = structuredClone(DEFAULT_SETTINGS);
	guard = new RiskGuard({
		clock,
		limits: () => pumpLimits(settings),
		copy: PUMP_RISK_COPY,
		tzOffsetMin: () => CDT,
	});
});

describe("local day helpers", () => {
	it("finds the next local midnight and sums only today's pnl", () => {
		expect(nextLocalMidnight(NOW, CDT)).toBe(LOCAL_MIDNIGHT);
		const closes = [
			closed(-100_000_000n, LOCAL_MIDNIGHT - 24 * 60 * MIN - MIN),
			closed(-30_000_000n, NOW - 60 * MIN),
			closed(10_000_000n, NOW - 5 * MIN),
		];
		expect(dailyPnl(closes, NOW, CDT)).toBe(-20_000_000n);
	});

	it("defaults the offset to local minus UTC", () => {
		expect(defaultTzOffsetMin()).toBe(-new Date().getTimezoneOffset());
	});
});

describe("RiskGuard.canOpen", () => {
	it("allows an approved auto snipe under every limit", () => {
		expect(guard.canOpen("auto", [], 0, approved)).toEqual({ ok: true });
	});

	it("blocks everything while paused, first", () => {
		guard.setPaused(true, "Kill switch");
		expect(guard.canOpen("manual", [], 5, approved)).toEqual({ ok: false, reason: "Engine paused" });
		guard.setPaused(false, null);
		expect(guard.canOpen("auto", [], 0, approved)).toEqual({ ok: true });
	});

	it("enforces max positions for both kinds", () => {
		expect(guard.canOpen("auto", [], 3, approved)).toEqual({ ok: false, reason: "Max positions (3) reached" });
		expect(guard.canOpen("manual", [], 3, approved)).toEqual({ ok: false, reason: "Max positions (3) reached" });
	});

	it("blocks auto when auto-snipe is off", () => {
		settings.autoSnipe = false;
		expect(guard.canOpen("auto", [], 0, approved)).toEqual({ ok: false, reason: "Auto-snipe off" });
		expect(guard.canOpen("manual", [], 0, approved)).toEqual({ ok: true });
	});

	it("holds auto snipes after the daily loss cap until local midnight", async () => {
		const closes = [closed(-160_000_000n, NOW - 10 * MIN)];
		expect(guard.canOpen("auto", closes, 0, approved)).toEqual({ ok: false, reason: "Daily loss cap hit" });
		expect(guard.state(closes).dailyCapUntil).toBe(LOCAL_MIDNIGHT);
		expect(guard.canOpen("manual", closes, 0, approved)).toEqual({ ok: true });
		await clock.advance(LOCAL_MIDNIGHT - NOW + MIN);
		expect(guard.canOpen("auto", closes, 0, approved)).toEqual({ ok: true });
		expect(guard.state(closes).dailyCapUntil).toBeNull();
	});

	it("cools down after three losses until the last loss plus 10 minutes", async () => {
		const lastLoss = NOW - 2 * MIN;
		const closes = [closed(-1n, NOW - 4 * MIN), closed(-1n, NOW - 3 * MIN), closed(-1n, lastLoss)];
		expect(guard.canOpen("auto", closes, 0, approved)).toEqual({ ok: false, reason: "Tilt cooldown until 23:38" });
		expect(guard.state(closes).tiltUntil).toBe(lastLoss + 10 * MIN);
		await clock.advance(8 * MIN);
		expect(guard.canOpen("auto", closes, 0, approved)).toEqual({ ok: true });
		expect(guard.state(closes).tiltUntil).toBeNull();
	});

	it("requires an approved verdict for auto snipes", () => {
		expect(guard.canOpen("auto", [], 0, { holdConfirmed: false, signal: "rejected" })).toEqual({
			ok: false,
			reason: "Not approved",
		});
		expect(guard.canOpen("auto", [], 0, { holdConfirmed: false, signal: null })).toEqual({
			ok: false,
			reason: "Not approved",
		});
	});

	it("needs a hold for manual snipes during tilt or on rejected coins", () => {
		const tilted: Outcome[] = [closed(-1n, NOW - 3 * MIN), closed(-1n, NOW - 2 * MIN), closed(-1n, NOW - MIN)];
		expect(guard.canOpen("manual", tilted, 0, { holdConfirmed: false, signal: "approved" })).toEqual({
			ok: false,
			reason: "Hold to confirm during tilt",
		});
		expect(guard.canOpen("manual", tilted, 0, { holdConfirmed: true, signal: "approved" })).toEqual({
			ok: true,
		});
		expect(guard.canOpen("manual", [], 0, { holdConfirmed: false, signal: "rejected" })).toEqual({
			ok: false,
			reason: "Hold to snipe a rejected coin",
		});
		expect(guard.canOpen("manual", [], 0, { holdConfirmed: true, signal: "rejected" })).toEqual({ ok: true });
		expect(guard.canOpen("manual", [], 0, { holdConfirmed: false, signal: null })).toEqual({ ok: true });
	});
});

describe("RiskGuard.state", () => {
	it("reports risk state with daily pnl as a decimal string", () => {
		guard.setPaused(true, "Kill switch");
		const closes = [closed(-30_000_000n, NOW - MIN), closed(-5_000_000n, NOW - 30_000)];
		expect(guard.state(closes)).toEqual({
			auto: true,
			paused: true,
			pausedReason: "Kill switch",
			tiltLosses: 2,
			tiltUntil: null,
			dailyPnl: "-35000000",
			dailyCapUntil: null,
		});
	});
});
