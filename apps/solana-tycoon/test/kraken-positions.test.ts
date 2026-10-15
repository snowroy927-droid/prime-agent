import { describe, expect, it } from "vitest";
import type { KrakenLot } from "../src/engine/kraken/ledger";
import {
	evaluateKrakenExit,
	type KrakenPositionState,
	krakenFromLot,
	krakenIsStale,
	krakenRevalue,
	krakenToView,
} from "../src/engine/kraken/positions";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";

const s = DEFAULT_KRAKEN_SETTINGS;
const OPEN = 1_000_000;
const COST = 100_000_000n;

const lot: KrakenLot = {
	positionId: "k1",
	mode: "paper",
	pair: "PEPEUSD",
	symbol: "PEPE",
	openedAt: OPEN,
	costUsdMicros: COST,
	proceedsUsdMicros: 0n,
	lots: 4_000_000n,
};

// Revalues at a PnL given in hundredths of a basis point (so 59_999 is 5.9999%).
const at = (p: KrakenPositionState, pnlTenThousandths: number, when = OPEN + 1_000): KrakenPositionState =>
	krakenRevalue(p, COST + (COST * BigInt(pnlTenThousandths)) / 1_000_000n, "0.00001234", when);

describe("Kraken exits", () => {
	it("takes profit at exactly +6% and not at +5.9999%", () => {
		const p = krakenFromLot(lot);
		expect(evaluateKrakenExit(at(p, 59_999), OPEN + 1_000, s)).toBeNull();
		expect(evaluateKrakenExit(at(p, 60_000), OPEN + 1_000, s)).toBe("take_profit");
	});

	it("stops out at exactly -3%", () => {
		const p = krakenFromLot(lot);
		expect(evaluateKrakenExit(at(p, -29_999), OPEN + 1_000, s)).toBeNull();
		expect(evaluateKrakenExit(at(p, -30_000), OPEN + 1_000, s)).toBe("stop_loss");
	});

	it("arms the trailing stop only once the peak passes 2% and exits 2 points under it", () => {
		const p = krakenFromLot(lot);
		const peakTwo = at(p, 20_000);
		expect(evaluateKrakenExit(at(peakTwo, -5_000), OPEN + 1_000, s)).toBeNull();
		const peakTwoAndHalf = at(p, 25_000);
		expect(evaluateKrakenExit(at(peakTwoAndHalf, 6_000), OPEN + 1_000, s)).toBeNull();
		expect(evaluateKrakenExit(at(peakTwoAndHalf, 5_000), OPEN + 1_000, s)).toBe("trailing");
	});

	it("sells after the maximum hold", () => {
		const p = krakenFromLot(lot);
		const end = OPEN + 120 * 60_000;
		expect(evaluateKrakenExit(at(p, 0, end - 1), end - 1, s)).toBeNull();
		expect(evaluateKrakenExit(at(p, 0, end), end, s)).toBe("max_hold");
	});

	it("never exits a halted, pending or stale position", () => {
		const winner = at(krakenFromLot(lot), 100_000);
		expect(evaluateKrakenExit({ ...winner, halted: true }, OPEN + 1_000, s)).toBeNull();
		expect(evaluateKrakenExit({ ...winner, pendingOrder: true }, OPEN + 1_000, s)).toBeNull();
		expect(krakenIsStale(winner, OPEN + 11_001, s)).toBe(true);
		expect(evaluateKrakenExit(winner, OPEN + 11_001, s)).toBeNull();
		expect(evaluateKrakenExit(krakenFromLot(lot), OPEN + 1_000, s)).toBeNull();
	});

	it("renders a view with decimal strings and its stale and halted flags", () => {
		const view = krakenToView({ ...at(krakenFromLot(lot), 10_000), halted: true }, OPEN + 1_000, s);
		expect(view).toMatchObject({
			id: "k1",
			pair: "PEPEUSD",
			costUsdMicros: "100000000",
			valueUsdMicros: "101000000",
			lots: "4000000",
			pnlPct: 1,
			price: "0.00001234",
			stale: false,
			halted: true,
		});
	});
});
