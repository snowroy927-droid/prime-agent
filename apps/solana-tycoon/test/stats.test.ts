import { describe, expect, it } from "vitest";
import { computeLaunchStats, computeStats, VERDICT_MIN_CLOSES } from "../src/shared/stats";
import type { CheckResult, ExitReason, Launch, RuleId } from "../src/shared/types";
import { closed } from "./helpers/trades";

const sol = (n: number) => BigInt(Math.round(n * 1e9));
const HOUR = 3_600_000;

describe("computeStats", () => {
	it("summarises a small sample and keeps collecting", () => {
		const closes = [0.1, -0.05, 0.02, -0.01].map((v, i) => closed(sol(v), (i + 1) * 1_000));
		const stats = computeStats(closes, 0);
		expect(stats.trades).toBe(4);
		expect(stats.wins).toBe(2);
		expect(stats.losses).toBe(2);
		expect(stats.winRate).toBe(0.5);
		expect(stats.profitFactor).toBeCloseTo(2, 10);
		expect(stats.expectancySol).toBeCloseTo(0.015, 10);
		expect(stats.expectancyCi90?.[0]).toBeCloseTo(-0.037236, 5);
		expect(stats.expectancyCi90?.[1]).toBeCloseTo(0.067236, 5);
		expect(stats.avgWinSol).toBeCloseTo(0.06, 10);
		expect(stats.avgLossSol).toBeCloseTo(-0.03, 10);
		expect(stats.bestSol).toBeCloseTo(0.1, 10);
		expect(stats.worstSol).toBeCloseTo(-0.05, 10);
		expect(stats.realizedSol).toBeCloseTo(0.06, 10);
		expect(stats.cumulative.map((p) => p.at)).toEqual([1_000, 2_000, 3_000, 4_000]);
		expect(stats.cumulative.at(-1)?.sol).toBeCloseTo(0.06, 10);
		expect(stats.holds[0]).toEqual({ holdSec: 60, pnlSol: 0.1 });
		expect(stats.verdict).toEqual({ kind: "collecting", needed: VERDICT_MIN_CLOSES - 4 });
		expect(stats.verdict).toEqual({ kind: "collecting", needed: 46 });
	});

	it("handles an empty history", () => {
		const stats = computeStats([], 0);
		expect(stats.trades).toBe(0);
		expect(stats.winRate).toBe(0);
		expect(stats.profitFactor).toBeNull();
		expect(stats.expectancyCi90).toBeNull();
		expect(stats.bestSol).toBeNull();
		expect(stats.pnlByHour).toHaveLength(24);
		expect(stats.verdict).toEqual({ kind: "collecting", needed: 50 });
	});

	it("calls a consistently losing strategy losing", () => {
		const closes = Array.from({ length: 50 }, (_, i) => closed(sol(-0.01), i * 1_000));
		expect(computeStats(closes, 0).verdict).toEqual({ kind: "losing" });
	});

	it("calls a positive-expectancy strategy not losing", () => {
		const closes = Array.from({ length: 50 }, (_, i) => closed(sol(i % 2 === 0 ? 0.02 : -0.01), i * 1_000));
		expect(computeStats(closes, 0).verdict).toEqual({ kind: "not_losing" });
	});

	it("counts exit reasons per reason", () => {
		const reasons: ExitReason[] = ["take_profit", "stop_loss", "stop_loss", "kill"];
		const closes = reasons.map((reason, i) => ({ ...closed(sol(0.01), i * 1_000), reason }));
		expect(computeStats(closes, 0).exitReasons).toEqual({
			take_profit: 1,
			stop_loss: 2,
			trailing: 0,
			manual: 0,
			kill: 1,
			max_hold: 0,
		});
	});

	it("buckets pnl by local close hour using Date#getTimezoneOffset's sign", () => {
		const at = Date.UTC(2026, 9, 15, 3, 30);
		const stats = computeStats([closed(sol(0.05), at)], 300);
		expect(stats.pnlByHour[22]).toBeCloseTo(0.05, 10);
		expect(stats.pnlByHour[3]).toBe(0);
	});
});

const launch = (mint: string, receivedAt: number): Launch => ({
	mint,
	name: mint,
	symbol: mint.toUpperCase(),
	creator: null,
	signature: null,
	uri: null,
	marketCapSol: null,
	receivedAt,
});

const check = (mint: string, failing: RuleId | null, attempt = 1, checkedAt = attempt * 1_000): CheckResult => ({
	mint,
	verdict: failing ? "rejected" : "approved",
	results: [
		{ rule: "quote_sol", pass: true, reason: "SOL quote" },
		...(failing ? [{ rule: failing, pass: false, reason: "failed" }] : []),
	],
	reason: failing ?? "all rules passed",
	checkedAt,
	attempt,
});

describe("computeLaunchStats", () => {
	it("computes pass rate and the most common rejection", () => {
		const checks = [
			check("a", "blocklist"),
			check("b", "blocklist"),
			check("c", "serial_launcher"),
			check("d", null),
		];
		const stats = computeLaunchStats([], checks, 0);
		expect(stats.checked).toBe(4);
		expect(stats.approved).toBe(1);
		expect(stats.passRate).toBe(0.25);
		expect(stats.topRejections[0]).toEqual({ rule: "blocklist", count: 2 });
		expect(stats.topRejections).toHaveLength(2);
	});

	it("uses only the latest final check per mint", () => {
		const pending: CheckResult = { ...check("a", null), verdict: "pending", attempt: 1 };
		const checks = [pending, check("a", "top_holder", 2), check("a", null, 3)];
		const stats = computeLaunchStats([], checks, 0);
		expect(stats.checked).toBe(1);
		expect(stats.approved).toBe(1);
		expect(stats.topRejections).toEqual([]);
	});

	it("buckets launches over the last 24 hours, oldest first", () => {
		const now = 100 * HOUR;
		const launches = [
			launch("old", now - 25 * HOUR),
			launch("first", now - 23.5 * HOUR),
			launch("recent", now - 10 * 60_000),
			launch("recent2", now),
		];
		const stats = computeLaunchStats(launches, [], now);
		expect(stats.perHour).toHaveLength(24);
		expect(stats.perHour[0]).toBe(1);
		expect(stats.perHour[23]).toBe(2);
		expect(stats.perHour.reduce((a, b) => a + b, 0)).toBe(3);
	});
});
