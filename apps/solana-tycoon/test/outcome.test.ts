import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { type RiskCopy, RiskGuard, type RiskLimits } from "../src/engine/risk/guard";
import { type Outcome, pumpOutcome } from "../src/shared/outcome";
import { computeStatsOf } from "../src/shared/stats";
import { tiltUntilOf } from "../src/shared/tilt";
import { closed } from "./helpers/trades";

const usd = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const outcome = (pnl: bigint, closedAt: number): Outcome => ({
	pnl,
	openedAt: closedAt - 60_000,
	closedAt,
	reason: pnl > 0n ? "take_profit" : "stop_loss",
});
const KRAKEN_COPY: RiskCopy = {
	autoOff: "Auto-buy off",
	notApproved: "Not eligible",
	rejectedHold: "Hold to buy a pair the rule skipped",
};
const limits = (auto: boolean): RiskLimits => ({
	maxPositions: 5,
	auto,
	dailyLossCap: usd(60),
	tiltLosses: 3,
	tiltCooldownMin: 30,
});

describe("currency-neutral outcomes", () => {
	it("computes stats in whole units of the desk currency", () => {
		const stats = computeStatsOf([outcome(usd(2), 61_000), outcome(usd(-0.5), 122_000)], 0, 1_000_000);
		expect(stats.realized).toBeCloseTo(1.5);
		expect(stats.best).toBe(2);
		expect(stats.worst).toBe(-0.5);
		expect(stats.cumulative).toEqual([
			{ at: 61_000, value: 2 },
			{ at: 122_000, value: 1.5 },
		]);
		expect(stats.holds[0]).toEqual({ holdSec: 60, pnl: 2 });
	});

	it("starts a tilt cooldown after the configured number of losses", () => {
		const losses = [1, 2, 3].map((i) => outcome(-1n, i * 1_000));
		expect(tiltUntilOf(losses, 3, 30)).toBe(3_000 + 1_800_000);
		expect(tiltUntilOf(losses.slice(0, 2), 3, 30)).toBeNull();
	});

	it("uses the desk's own copy in risk reasons and reports daily PnL in minor units", () => {
		const clock = new ManualClock(130_000);
		const off = new RiskGuard({ clock, limits: () => limits(false), copy: KRAKEN_COPY, tzOffsetMin: () => 0 });
		expect(off.canOpen("auto", [], 0, { holdConfirmed: false, signal: "approved" })).toEqual({
			ok: false,
			reason: "Auto-buy off",
		});
		expect(off.canOpen("manual", [], 0, { holdConfirmed: false, signal: "rejected" })).toEqual({
			ok: false,
			reason: "Hold to buy a pair the rule skipped",
		});
		const on = new RiskGuard({ clock, limits: () => limits(true), copy: KRAKEN_COPY, tzOffsetMin: () => 0 });
		expect(on.canOpen("auto", [], 0, { holdConfirmed: false, signal: null })).toEqual({
			ok: false,
			reason: "Not eligible",
		});
		const state = on.state([outcome(usd(2), 61_000), outcome(usd(-0.5), 122_000)]);
		expect(state).toMatchObject({ auto: true, dailyPnl: "1500000", tiltLosses: 1 });
	});

	it("keeps pump.fun PnL in lamports", () => {
		const trade = closed(20_000_000n, 3_000);
		expect(pumpOutcome(trade)).toEqual({
			pnl: 20_000_000n,
			openedAt: trade.openedAt,
			closedAt: 3_000,
			reason: trade.reason,
		});
	});
});
