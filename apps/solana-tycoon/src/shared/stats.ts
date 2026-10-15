import { byClosedAt } from "./combo";
import type { CheckResult, ClosedTrade, ExitReason, Launch, RuleId } from "./types";
import { lamportsToSol } from "./units";

export type ExperimentVerdict = { kind: "collecting"; needed: number } | { kind: "losing" } | { kind: "not_losing" };

export interface Stats {
	trades: number;
	wins: number;
	losses: number;
	winRate: number;
	avgWinSol: number;
	avgLossSol: number;
	profitFactor: number | null;
	expectancySol: number;
	expectancyCi90: [number, number] | null;
	bestSol: number | null;
	worstSol: number | null;
	realizedSol: number;
	cumulative: { at: number; sol: number }[];
	pnlByHour: number[];
	holds: { holdSec: number; pnlSol: number }[];
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

export function computeStats(closes: readonly ClosedTrade[], tzOffsetMin: number): Stats {
	const sorted = byClosedAt(closes);
	const pnls = sorted.map((trade) => lamportsToSol(trade.pnlLamports));
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
	const cumulative: { at: number; sol: number }[] = [];
	let running = 0;
	sorted.forEach((trade, i) => {
		exitReasons[trade.reason] += 1;
		// tzOffsetMin follows Date#getTimezoneOffset: minutes to add to local time to reach UTC.
		const localHour = new Date(trade.closedAt - tzOffsetMin * 60_000).getUTCHours();
		pnlByHour[localHour] += pnls[i];
		running += pnls[i];
		cumulative.push({ at: trade.closedAt, sol: running });
	});

	const ci = ci90(pnls);
	return {
		trades: sorted.length,
		wins: winPnls.length,
		losses: lossPnls.length,
		winRate: sorted.length === 0 ? 0 : winPnls.length / sorted.length,
		avgWinSol: mean(winPnls),
		avgLossSol: mean(lossPnls),
		profitFactor: grossLoss === 0 ? null : grossWin / grossLoss,
		expectancySol: mean(pnls),
		expectancyCi90: ci,
		bestSol: pnls.length === 0 ? null : Math.max(...pnls),
		worstSol: pnls.length === 0 ? null : Math.min(...pnls),
		realizedSol: sum(pnls),
		cumulative,
		pnlByHour,
		holds: sorted.map((trade, i) => ({ holdSec: (trade.closedAt - trade.openedAt) / 1000, pnlSol: pnls[i] })),
		exitReasons,
		verdict: verdictFor(sorted.length, ci),
	};
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
