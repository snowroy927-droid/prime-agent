import { describe, expect, it } from "vitest";
import { formatSol, haircut, lamportsToSol, pnlPct, solToLamports } from "../src/shared/units";

describe("units", () => {
	it("converts SOL to lamports, rounding to the nearest lamport", () => {
		expect(solToLamports(0.05)).toBe(50_000_000n);
		expect(solToLamports(0.1 + 0.2)).toBe(300_000_000n);
	});

	it("converts lamports to SOL from bigint or decimal string", () => {
		expect(lamportsToSol(1_500_000_000n)).toBe(1.5);
		expect(lamportsToSol("250000000")).toBe(0.25);
	});

	it("formats SOL with a sign for nonzero amounts", () => {
		expect(formatSol(50_000_000n)).toBe("+0.0500");
		expect(formatSol(-120_000_000n, 2)).toBe("-0.12");
		expect(formatSol(0n)).toBe("0.0000");
	});

	it("applies a basis-point haircut with floor rounding", () => {
		expect(haircut(1_000_000n, 300)).toBe(970_000n);
		expect(haircut(999n, 300)).toBe(969n);
	});

	it("computes percentage PnL from cost and returned lamports", () => {
		expect(pnlPct(100n, 250n)).toBe(150);
		expect(pnlPct(200n, 50n)).toBe(-75);
	});
});
