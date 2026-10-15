import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { pump, web3 } from "../src/engine/chain/solana";
import type { CurveSnapshot, Globals } from "../src/engine/chain/types";
import {
	curveMarketCapSol,
	curvePriceSol,
	poolPriceSol,
	quoteBuyTokens,
	quotePoolSellLamports,
	quoteSellLamports,
} from "../src/engine/trader/quote";
import { fixtureCurve, fixtureGlobal, fixturePoolSnapshot } from "./helpers/curves";

const globals: Globals = { global: fixtureGlobal(), feeConfig: null };
const snap = (): CurveSnapshot => ({ mint: "m", curve: fixtureCurve(), tokenProgram: "spl", slot: 1, at: 0 });

describe("curve quotes", () => {
	it("matches the SDK's buy quote", () => {
		const s = snap();
		const direct = pump.getBuyTokenAmountFromSolAmount({
			global: globals.global,
			feeConfig: null,
			mintSupply: s.curve.tokenTotalSupply,
			bondingCurve: s.curve,
			amount: new BN(50_000_000),
			quoteMint: s.curve.quoteMint,
			creatorFeeBps: s.curve.creatorFeeBps,
		});
		const quoted = quoteBuyTokens(s, globals, 50_000_000n);
		expect(quoted).toBe(BigInt(direct.toString()));
		expect(quoted).toBeGreaterThan(0n);
	});

	it("matches the SDK's sell quote", () => {
		const s = snap();
		const direct = pump.getSellSolAmountFromTokenAmount({
			global: globals.global,
			feeConfig: null,
			mintSupply: s.curve.tokenTotalSupply,
			bondingCurve: s.curve,
			amount: new BN(1_000_000_000),
		});
		expect(quoteSellLamports(s, globals, 1_000_000_000n)).toBe(BigInt(direct.toString()));
	});

	it("prices a fresh curve at 30 SOL over 1.073B tokens", () => {
		const curve = fixtureCurve();
		expect(curvePriceSol(curve)).toBeCloseTo(30 / 1_073_000_000, 12);
		expect(curveMarketCapSol(curve)).toBeGreaterThan(27);
		expect(curveMarketCapSol(curve)).toBeLessThan(28);
	});
});

describe("pool quotes", () => {
	it("prices a pool from reserves and quotes a sell below the quote reserve", () => {
		const pool = fixturePoolSnapshot(web3.Keypair.generate().publicKey);
		expect(poolPriceSol(pool)).toBeCloseTo(85 / 200_000_000, 15);
		const lamports = quotePoolSellLamports(pool, 1_000_000_000_000n);
		expect(lamports).toBeGreaterThan(0n);
		expect(lamports).toBeLessThan(pool.quoteReserve);
	});
});
