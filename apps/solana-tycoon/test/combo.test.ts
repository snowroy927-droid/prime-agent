import { describe, expect, it } from "vitest";
import { activeTier, COLD_MS, comboCount, isWin } from "../src/shared/combo";
import { closed, LOSS, WIN } from "./helpers/trades";

const wins = (n: number, start = 1_000) => Array.from({ length: n }, (_, i) => closed(WIN, start + i * 1_000));

describe("combo", () => {
	it("starts at terminal with no closes", () => {
		expect(comboCount([])).toBe(0);
		expect(activeTier([], 0)).toBe("terminal");
	});

	it("counts a win only when pnl is positive", () => {
		expect(isWin(closed(1n, 1))).toBe(true);
		expect(isWin(closed(0n, 1))).toBe(false);
		expect(isWin(closed(LOSS, 1))).toBe(false);
	});

	it("climbs tiers with the trailing win streak", () => {
		expect(activeTier(wins(1), 10_000)).toBe("terminal");
		expect(activeTier(wins(2), 10_000)).toBe("ice");
		expect(activeTier(wins(3), 10_000)).toBe("neon");
		expect(activeTier(wins(4), 10_000)).toBe("gold");
		expect(activeTier(wins(5), 10_000)).toBe("fever");
		expect(activeTier(wins(9), 20_000)).toBe("fever");
	});

	it("goes cold after a loss, then back to terminal once COLD_MS passes", () => {
		const loss = closed(LOSS, 10_000);
		const closes = [...wins(4), loss];
		expect(comboCount(closes)).toBe(0);
		expect(activeTier(closes, loss.closedAt + 5_000)).toBe("cold");
		expect(activeTier(closes, loss.closedAt + COLD_MS + 1_000)).toBe("terminal");
	});

	it("resets the combo on a breakeven close without going cold", () => {
		const even = closed(0n, 10_000);
		const closes = [...wins(3), even];
		expect(comboCount(closes)).toBe(0);
		expect(activeTier(closes, even.closedAt + 1_000)).toBe("terminal");
	});

	it("orders closes by closedAt regardless of input order", () => {
		const loss = closed(LOSS, 500);
		const closes = [...wins(3), loss].reverse();
		expect(comboCount(closes)).toBe(3);
		expect(activeTier(closes, 10_000)).toBe("neon");
	});
});
