import { describe, expect, it } from "vitest";
import { evaluateExit, fromLot, isStale, type PositionState, revalue, toView } from "../src/engine/trader/positions";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";

const COST = 50_000_000n;
const OPENED = 1_000_000;

const base = (): PositionState =>
	fromLot({
		positionId: "p1",
		mode: "paper",
		mint: "Mint111",
		symbol: "ZORP",
		openedAt: OPENED,
		costLamports: COST,
		proceedsLamports: 0n,
		tokenAmount: 1_000_000n,
	});

const at = (pnlPct: number, now = OPENED + 60_000): PositionState =>
	revalue(base(), (COST * BigInt(100 + pnlPct)) / 100n, 0.00000005, now);

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe("positions", () => {
	it("starts unpriced from a ledger lot", () => {
		const p = base();
		expect(p).toMatchObject({
			id: "p1",
			valueLamports: null,
			pnlPct: null,
			peakPnlPct: 0,
			priceAt: null,
			pendingOrder: false,
		});
		expect(isStale(p, OPENED, DEFAULT_SETTINGS)).toBe(true);
	});

	it("revalues with realized proceeds after a partial sell and tracks the peak", () => {
		const half = { ...base(), proceedsLamports: 40_000_000n, tokenAmount: 500_000n };
		const p = revalue(half, 30_000_000n, 0.00000006, OPENED + 1_000);
		expect(p.pnlPct).toBe(40);
		expect(p.peakPnlPct).toBe(40);
		const lower = revalue(p, 10_000_000n, 0.00000002, OPENED + 2_000);
		expect(lower.pnlPct).toBe(0);
		expect(lower.peakPnlPct).toBe(40);
	});

	it("fires take profit at exactly the target", () => {
		expect(evaluateExit(at(99), OPENED + 60_000, DEFAULT_SETTINGS)).toBeNull();
		expect(evaluateExit(at(100), OPENED + 60_000, DEFAULT_SETTINGS)).toBe("take_profit");
	});

	it("fires stop loss at exactly the limit", () => {
		expect(evaluateExit(at(-29), OPENED + 60_000, DEFAULT_SETTINGS)).toBeNull();
		expect(evaluateExit(at(-30), OPENED + 60_000, DEFAULT_SETTINGS)).toBe("stop_loss");
	});

	it("fires max hold at exactly 30 minutes, ahead of other exits", () => {
		const limit = OPENED + 30 * 60_000;
		expect(evaluateExit(at(10, limit - 1), limit - 1, DEFAULT_SETTINGS)).toBeNull();
		expect(evaluateExit(at(10, limit), limit, DEFAULT_SETTINGS)).toBe("max_hold");
		expect(evaluateExit(at(150, limit), limit, DEFAULT_SETTINGS)).toBe("max_hold");
	});

	it("fires the trailing stop at peak minus the trail", () => {
		const s = settings({ trailingStopPct: 20, takeProfitPct: 500 });
		const peaked = at(60);
		const now = OPENED + 120_000;
		const at41 = revalue(peaked, (COST * 141n) / 100n, 0.00000005, now);
		const at40 = revalue(peaked, (COST * 140n) / 100n, 0.00000005, now);
		expect(at41.peakPnlPct).toBe(60);
		expect(evaluateExit(at41, now, s)).toBeNull();
		expect(evaluateExit(at40, now, s)).toBe("trailing");
	});

	it("blocks every exit on a stale price, including max hold", () => {
		const limit = OPENED + 30 * 60_000;
		const p = at(-90, limit - 20_000);
		expect(isStale(p, limit, DEFAULT_SETTINGS)).toBe(true);
		expect(evaluateExit(p, limit, DEFAULT_SETTINGS)).toBeNull();
		const fresh = at(-90, limit - 10_000);
		expect(isStale(fresh, limit, DEFAULT_SETTINGS)).toBe(false);
	});

	it("blocks exits while an order is pending", () => {
		const p = { ...at(-50), pendingOrder: true };
		expect(evaluateExit(p, OPENED + 60_000, DEFAULT_SETTINGS)).toBeNull();
	});

	it("renders a wire view with decimal strings and the stale flag", () => {
		const p = at(20);
		expect(toView(p, OPENED + 60_000, DEFAULT_SETTINGS)).toEqual({
			id: "p1",
			mode: "paper",
			mint: "Mint111",
			symbol: "ZORP",
			openedAt: OPENED,
			costLamports: "50000000",
			tokenAmount: "1000000",
			proceedsLamports: "0",
			valueLamports: "60000000",
			pnlPct: 20,
			peakPnlPct: 20,
			priceSol: 0.00000005,
			priceAt: OPENED + 60_000,
			stale: false,
			migrated: false,
			pendingOrder: false,
		});
		expect(toView(p, OPENED + 120_000, DEFAULT_SETTINGS).stale).toBe(true);
	});
});
