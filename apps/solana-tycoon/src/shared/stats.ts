import { byClosedAt } from "./combo";
import { type Outcome, pumpOutcome } from "./outcome";
import type { CheckResult, ClosedTrade, ExitReason, Launch, RuleId } from "./types";
import { LAMPORTS_PER_SOL } from "./units";

export type ExperimentVerdict = { kind: "collecting"; needed: number } | { kind: "losing" } | { kind: "not_losing" };

// Amounts are in whole units of the desk's currency: SOL for pump.fun, USD for Kraken.
export interface Stats {
	trades: number;
	wins: number;
	losses: number;
	winRate: number;
	avgWin: number;
	avgLoss: number;
	profitFactor: number | null;
	expectancy: number;
	expectancyCi90: [number, number] | null;
	best: number | null;
	worst: number | null;
	realized: number;
	cumulative: { at: number; value: number }[];
	pnlByHour: number[];
	holds: { holdSec: number; pnl: number }[];
	exitReasons: Record<ExitReason, number>;
	verdict: ExperimentVerdict;
}

export interface LaunchStats {
	perHour: number[];
	checked: number;
	approved: number;
	passRate: number;
	topRejections: { rule: RuleId; count: number }[];
}

export const VERDICT_MIN_CLOSES = 50;

const Z_90 = 1.645;
const HOUR_MS = 3_600_000;

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length;
}

function ci90(values: readonly number[]): [number, number] | null {
	const n = values.length;
	if (n < 2) return null;
	const m = mean(values);
	const variance = sum(values.map((v) => (v - m) ** 2)) / (n - 1);
	const margin = (Z_90 * Math.sqrt(variance)) / Math.sqrt(n);
	return [m - margin, m + margin];
}

function verdictFor(n: number, ci: [number, number] | null): ExperimentVerdict {
	if (n < VERDICT_MIN_CLOSES || ci === null)
		return { kind: "collecting", needed: Math.max(0, VERDICT_MIN_CLOSES - n) };
	return ci[1] < 0 ? { kind: "losing" } : { kind: "not_losing" };
}

export function computeStatsOf(outcomes: readonly Outcome[], tzOffsetMin: number, unitsPerWhole: number): Stats {
	const sorted = byClosedAt(outcomes);
	const pnls = sorted.map((outcome) => Number(outcome.pnl) / unitsPerWhole);
	const winPnls = pnls.filter((p) => p > 0);
	const lossPnls = pnls.filter((p) => p < 0);
	const grossWin = sum(winPnls);
	const grossLoss = -sum(lossPnls);

	const exitReasons: Record<ExitReason, number> = {
		take_profit: 0,
		stop_loss: 0,
		trailing: 0,
		manual: 0,
		kill: 0,
		max_hold: 0,
	};
	const pnlByHour = Array.from({ length: 24 }, () => 0);
	const cumulative: { at: number; value: number }[] = [];
	let running = 0;
	sorted.forEach((outcome, i) => {
		exitReasons[outcome.reason] += 1;
		// tzOffsetMin is local time minus UTC in minutes (-300 for UTC-5), i.e. -Date#getTimezoneOffset().
		const localHour = new Date(outcome.closedAt + tzOffsetMin * 60_000).getUTCHours();
		pnlByHour[localHour] += pnls[i];
		running += pnls[i];
		cumulative.push({ at: outcome.closedAt, value: running });
	});

	const ci = ci90(pnls);
	return {
		trades: sorted.length,
		wins: winPnls.length,
		losses: lossPnls.length,
		winRate: sorted.length === 0 ? 0 : winPnls.length / sorted.length,
		avgWin: mean(winPnls),
		avgLoss: mean(lossPnls),
		profitFactor: grossLoss === 0 ? null : grossWin / grossLoss,
		expectancy: mean(pnls),
		expectancyCi90: ci,
		best: pnls.length === 0 ? null : Math.max(...pnls),
		worst: pnls.length === 0 ? null : Math.min(...pnls),
		realized: sum(pnls),
		cumulative,
		pnlByHour,
		holds: sorted.map((outcome, i) => ({ holdSec: (outcome.closedAt - outcome.openedAt) / 1000, pnl: pnls[i] })),
		exitReasons,
		verdict: verdictFor(sorted.length, ci),
	};
}

export function computeStats(closes: readonly ClosedTrade[], tzOffsetMin: number): Stats {
	return computeStatsOf(closes.map(pumpOutcome), tzOffsetMin, Number(LAMPORTS_PER_SOL));
}

function latestFinalChecks(checks: readonly CheckResult[]): CheckResult[] {
	const latest = new Map<string, CheckResult>();
	for (const check of checks) {
		if (check.verdict !== "approved" && check.verdict !== "rejected") continue;
		const seen = latest.get(check.mint);
		if (
			!seen ||
			check.attempt > seen.attempt ||
			(check.attempt === seen.attempt && check.checkedAt > seen.checkedAt)
		) {
			latest.set(check.mint, check);
		}
	}
	return [...latest.values()];
}

export function computeLaunchStats(
	launches: readonly Launch[],
	checks: readonly CheckResult[],
	now: number,
): LaunchStats {
	const perHour = Array.from({ length: 24 }, () => 0);
	for (const launch of launches) {
		const age = now - launch.receivedAt;
		if (age < 0 || age >= 24 * HOUR_MS) continue;
		perHour[23 - Math.floor(age / HOUR_MS)] += 1;
	}

	const finals = latestFinalChecks(checks);
	const approved = finals.filter((check) => check.verdict === "approved").length;
	const rejections = new Map<RuleId, number>();
	for (const check of finals) {
		if (check.verdict !== "rejected") continue;
		const failed = check.results.find((result) => !result.pass);
		if (failed) rejections.set(failed.rule, (rejections.get(failed.rule) ?? 0) + 1);
	}
	const topRejections = [...rejections.entries()]
		.map(([rule, count]) => ({ rule, count }))
		.sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
		.slice(0, 5);

	return {
		perHour,
		checked: finals.length,
		approved,
		passRate: finals.length === 0 ? 0 : approved / finals.length,
		topRejections,
	};
}
