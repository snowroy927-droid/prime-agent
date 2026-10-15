import type { BondingCurve } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { pump, swap } from "../chain/solana";
import type { CurveSnapshot, Globals, PoolSnapshot } from "../chain/types";

const LAMPORTS_PER_SOL = 1e9;
const TOKEN_UNITS = 1e6;

const toBN = (value: bigint): BN => new BN(value.toString());
const toBigInt = (value: BN): bigint => BigInt(value.toString());

export function quoteBuyTokens(snap: CurveSnapshot, g: Globals, solLamports: bigint): bigint {
	return toBigInt(
		pump.getBuyTokenAmountFromSolAmount({
			global: g.global,
			feeConfig: g.feeConfig,
			mintSupply: snap.curve.tokenTotalSupply,
			bondingCurve: snap.curve,
			amount: toBN(solLamports),
			quoteMint: snap.curve.quoteMint,
			creatorFeeBps: snap.curve.creatorFeeBps,
		}),
	);
}

export function quoteSellLamports(snap: CurveSnapshot, g: Globals, tokenAmount: bigint): bigint {
	return toBigInt(
		pump.getSellSolAmountFromTokenAmount({
			global: g.global,
			feeConfig: g.feeConfig,
			mintSupply: snap.curve.tokenTotalSupply,
			bondingCurve: snap.curve,
			amount: toBN(tokenAmount),
		}),
	);
}

export function quotePoolSellLamports(pool: PoolSnapshot, tokenAmount: bigint): bigint {
	const result = swap.sellBaseInput({
		base: toBN(tokenAmount),
		slippage: 0,
		baseReserve: toBN(pool.baseReserve),
		quoteReserve: toBN(pool.quoteReserve),
		...pool.quote,
	});
	return toBigInt(result.uiQuote);
}

export function curvePriceSol(curve: BondingCurve): number {
	return (
		Number(curve.virtualQuoteReserves.toString()) /
		LAMPORTS_PER_SOL /
		(Number(curve.virtualTokenReserves.toString()) / TOKEN_UNITS)
	);
}

export function curveMarketCapSol(curve: BondingCurve): number {
	const cap = pump.bondingCurveMarketCap({
		mintSupply: curve.tokenTotalSupply,
		virtualQuoteReserves: curve.virtualQuoteReserves,
		virtualTokenReserves: curve.virtualTokenReserves,
	});
	return Number(cap.toString()) / LAMPORTS_PER_SOL;
}

export function poolPriceSol(pool: PoolSnapshot): number {
	const baseUnits = 10 ** pool.quote.baseMintAccount.decimals;
	return Number(pool.quoteReserve) / LAMPORTS_PER_SOL / (Number(pool.baseReserve) / baseUnits);
}
