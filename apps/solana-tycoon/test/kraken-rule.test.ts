import { describe, expect, it } from "vitest";
import { BarBook } from "../src/engine/kraken/bars";
import { evaluateRule, type RuleInput } from "../src/engine/kraken/rule";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const s = DEFAULT_KRAKEN_SETTINGS;
const base: RuleInput = {
	change5m: 1,
	change15m: 5,
	volumeUsd24h: 1_000_000,
	spreadPct: 0.2,
	usdVolume15m: 30_000,
	usdVolume60m: 40_000,
	minutesCovered: 60,
	held: false,
	cooldownUntil: null,
	now: NOW,
	tzOffsetMin: 0,
};

describe("evaluateRule", () => {
	it("passes a mover that meets every condition", () => {
		expect(evaluateRule(base, s)).toEqual({ status: "eligible", reason: "All rule checks passed" });
	});

	it("checks each condition at its exact boundary", () => {
		expect(evaluateRule({ ...base, change15m: 4 }, s).status).toBe("eligible");
		expect(evaluateRule({ ...base, change15m: 3.99 }, s)).toEqual({
			status: "small_move",
			reason: "Up 3.99% in 15m (needs 4%)",
		});
		expect(evaluateRule({ ...base, spreadPct: 0.6 }, s).status).toBe("eligible");
		expect(evaluateRule({ ...base, spreadPct: 0.61 }, s)).toEqual({
			status: "wide_spread",
			reason: "Spread 0.61% > 0.6%",
		});
		expect(evaluateRule({ ...base, usdVolume15m: 20_000, usdVolume60m: 40_000 }, s).status).toBe("eligible");
		expect(evaluateRule({ ...base, usdVolume15m: 19_000, usdVolume60m: 40_000 }, s)).toEqual({
			status: "no_volume_surge",
			reason: "Volume 1.9x hourly pace (needs 2x)",
		});
	});

	it("reports the first failing condition in order", () => {
		expect(evaluateRule({ ...base, minutesCovered: 14 }, s)).toEqual({
			status: "warming_up",
			reason: "Warming up (14 of 15 min)",
		});
		expect(evaluateRule({ ...base, volumeUsd24h: 120_000 }, s)).toEqual({
			status: "low_volume",
			reason: "Volume $120k < $250k",
		});
		expect(evaluateRule({ ...base, change5m: -0.5 }, s)).toEqual({ status: "not_rising", reason: "Falling over 5m" });
		expect(evaluateRule({ ...base, held: true }, s)).toEqual({ status: "held", reason: "Already held" });
		expect(evaluateRule({ ...base, cooldownUntil: NOW + 30 * 60_000 }, s)).toEqual({
			status: "cooldown",
			reason: "Cooldown until 12:30",
		});
	});
});

describe("BarBook", () => {
	const bar = (minutesAgo: number, close: number, volume = 1) => ({ begin: NOW - minutesAgo * 60_000, close, volume });

	it("measures change against the latest bar at or before the window start", () => {
		const bars = new BarBook();
		bars.seed("PEPE/USD", [bar(20, 1), bar(15, 1.5), bar(5, 1.8), bar(0, 2)]);
		expect(bars.change("PEPE/USD", 15, NOW)).toBeCloseTo((2 / 1.5 - 1) * 100);
		expect(bars.change("PEPE/USD", 60, NOW)).toBeNull();
		expect(bars.minutesCovered("PEPE/USD", NOW)).toBe(20);
		expect(bars.usdVolume("PEPE/USD", 15, NOW)).toBeCloseTo(1.8 + 2);
	});

	it("lets the latest update of a minute replace that minute's bar and keeps 60 bars", () => {
		const bars = new BarBook();
		for (let i = 70; i >= 0; i--) bars.update({ wsname: "WIF/USD", ...bar(i, 1) });
		bars.update({ wsname: "WIF/USD", ...bar(0, 3) });
		expect(bars.change("WIF/USD", 5, NOW)).toBeCloseTo(200);
		expect(bars.minutesCovered("WIF/USD", NOW)).toBe(59);
	});
});
