import { describe, expect, it } from "vitest";
import { applySettingsPatch, DEFAULT_SETTINGS, HARD_LIMITS } from "../src/shared/settings";

describe("settings", () => {
	it("defaults match the spec", () => {
		expect(DEFAULT_SETTINGS.buySol).toBe(0.05);
		expect(DEFAULT_SETTINGS.maxPositions).toBe(3);
		expect(DEFAULT_SETTINGS.dailyLossCapSol).toBe(0.15);
		expect(DEFAULT_SETTINGS.recheckDelaysSec).toEqual([10, 30]);
		expect(DEFAULT_SETTINGS.rug.minRealSol).toBe(1);
		expect(DEFAULT_SETTINGS.rug.blocklist).toEqual(["test", "rug", "scam", "fake", "honeypot"]);
		expect(DEFAULT_SETTINGS.paper.latencyMs).toBe(800);
		expect(DEFAULT_SETTINGS.paper.extraSlippageBps).toBe(300);
	});

	it("clamps hard limits", () => {
		const result = applySettingsPatch(DEFAULT_SETTINGS, { buySol: 5, maxPositions: 40 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.settings.buySol).toBe(HARD_LIMITS.buySolMax);
		expect(result.settings.maxPositions).toBe(HARD_LIMITS.maxPositionsMax);
		expect(result.settings.buySol).toBe(1);
		expect(result.settings.maxPositions).toBe(10);
	});

	it("rejects invalid patch and keeps current", () => {
		const negative = applySettingsPatch(DEFAULT_SETTINGS, { takeProfitPct: -5 });
		expect(negative.ok).toBe(false);
		if (!negative.ok) expect(negative.error).toContain("takeProfitPct");

		const wrongType = applySettingsPatch(DEFAULT_SETTINGS, { rug: { minHoldersInTop20: "ten" } });
		expect(wrongType.ok).toBe(false);

		const merged = applySettingsPatch(DEFAULT_SETTINGS, { paper: { latencyMs: 400 } });
		expect(merged.ok).toBe(true);
		if (!merged.ok) return;
		expect(merged.settings.paper).toEqual({ ...DEFAULT_SETTINGS.paper, latencyMs: 400 });
		expect(DEFAULT_SETTINGS.paper.latencyMs).toBe(800);
	});

	it("rejects out-of-range and non-integer values", () => {
		expect(applySettingsPatch(DEFAULT_SETTINGS, { stopLossPct: 120 }).ok).toBe(false);
		expect(applySettingsPatch(DEFAULT_SETTINGS, { maxPositions: 2.5 }).ok).toBe(false);
		expect(applySettingsPatch(DEFAULT_SETTINGS, { rug: { minHoldersInTop20: 21 } }).ok).toBe(false);
		expect(applySettingsPatch(DEFAULT_SETTINGS, { paper: { extraSlippageBps: 6000 } }).ok).toBe(false);
		expect(applySettingsPatch(DEFAULT_SETTINGS, "not an object").ok).toBe(false);
	});

	it("rejects unknown keys so typos surface instead of being dropped", () => {
		const result = applySettingsPatch(DEFAULT_SETTINGS, { buysol: 0.1 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("buysol");
	});

	it("does not let a patch reach the object prototype", () => {
		const result = applySettingsPatch(DEFAULT_SETTINGS, JSON.parse('{"__proto__": {"buySol": 0.9}}'));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.settings.buySol).toBe(0.05);
		expect(Object.getPrototypeOf(result.settings)).toBe(Object.prototype);
		expect(({} as { buySol?: number }).buySol).toBeUndefined();
	});
});
