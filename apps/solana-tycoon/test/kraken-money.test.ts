import { describe, expect, it } from "vitest";
import { decimalText, quoteBuy, quoteSell, toScaled } from "../src/engine/kraken/money";
import { DEFAULT_KRAKEN_SETTINGS, type KrakenPair } from "../src/shared/kraken";

const PEPE: KrakenPair = {
	pair: "PEPEUSD",
	wsname: "PEPE/USD",
	symbol: "PEPE",
	priceDecimals: 8,
	lotDecimals: 0,
	ordermin: null,
	costmin: null,
};
const paper = DEFAULT_KRAKEN_SETTINGS.paper;

describe("decimal text", () => {
	it("expands exponent notation without losing digits", () => {
		expect(decimalText(1.234e-8)).toBe("0.00000001234");
		expect(decimalText(12.5)).toBe("12.5");
		expect(decimalText("0.0001")).toBe("0.0001");
		expect(decimalText(1e21)).toBe("1000000000000000000000");
		expect(decimalText("2.5E-7")).toBe("0.00000025");
	});

	it("refuses values that are not finite numbers", () => {
		expect(() => decimalText(Number.NaN)).toThrow();
		expect(() => decimalText("abc")).toThrow();
	});

	it("scales to an integer at the pair's precision, truncating extra digits", () => {
		expect(toScaled("0.00000001234", 10)).toBe(123n);
		expect(toScaled("12.5", 2)).toBe(1250n);
		expect(toScaled(1.234e-8, 11)).toBe(1234n);
		expect(toScaled("7", 3)).toBe(7000n);
	});
});

describe("paper quotes", () => {
	it("buys whole lots with slippage and fees rounded against the trader", () => {
		expect(quoteBuy(50_000_000n, 1234n, PEPE, paper)).toEqual({
			ok: true,
			lots: 4_045_795n,
			notionalUsdMicros: 49_999_998n,
			feesUsdMicros: 400_000n,
		});
	});

	it("sells with proceeds rounded down and fees rounded up", () => {
		expect(quoteSell(4_045_795n, 1300n, PEPE, paper)).toEqual({
			ok: true,
			proceedsUsdMicros: 52_096_309n,
			feesUsdMicros: 420_132n,
		});
	});

	it("refuses orders below Kraken's minimums", () => {
		expect(quoteBuy(50_000_000n, 1234n, { ...PEPE, ordermin: "5000000" }, paper)).toEqual({
			ok: false,
			error: "Below Kraken minimum order",
		});
		expect(quoteBuy(50_000_000n, 1234n, { ...PEPE, costmin: "60" }, paper)).toEqual({
			ok: false,
			error: "Below Kraken minimum cost",
		});
		expect(quoteBuy(5n, 1234n, { ...PEPE, priceDecimals: 2 }, paper)).toEqual({
			ok: false,
			error: "Buy size below one lot",
		});
	});
});
