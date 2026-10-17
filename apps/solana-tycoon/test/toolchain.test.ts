import { describe, expect, it } from "vitest";
import { pump, splToken, swap, web3 } from "../src/engine/chain/solana";

describe("toolchain", () => {
	it("exposes the pump SDK functions the engine uses", () => {
		for (const fn of [
			pump.bondingCurvePda,
			pump.getBuyTokenAmountFromSolAmount,
			pump.getSellSolAmountFromTokenAmount,
			pump.bondingCurveMarketCap,
			pump.isBondingCurveMigrated,
			pump.newBondingCurve,
			swap.sellBaseInput,
			swap.canonicalPumpPoolPda,
			splToken.getAssociatedTokenAddressSync,
		]) {
			expect(typeof fn).toBe("function");
		}
		expect(typeof pump.PUMP_SDK.decodeBondingCurve).toBe("function");
		expect(typeof pump.OnlinePumpSdk).toBe("function");
		expect(typeof swap.PUMP_AMM_SDK.decodePool).toBe("function");
	});

	it("derives the same bonding curve PDA for a known mint from both SDK copies", () => {
		const mint = new web3.PublicKey("So11111111111111111111111111111111111111112");
		const fromPump = pump.bondingCurvePda(mint);
		const [expected] = web3.PublicKey.findProgramAddressSync(
			[Buffer.from("bonding-curve"), mint.toBuffer()],
			new web3.PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
		);
		expect(fromPump.toBase58()).toBe(expected.toBase58());
	});
});
