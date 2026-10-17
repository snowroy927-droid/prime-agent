import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { beforeEach, describe, expect, it } from "vitest";
import { PumpChain } from "../src/engine/chain/pumpChain";
import { RpcBudget } from "../src/engine/chain/rpcBudget";
import { pump, splToken, swap, web3 } from "../src/engine/chain/solana";
import { MAX_WATCHES, WatchLimitError } from "../src/engine/chain/types";
import { ManualClock } from "../src/engine/clock";
import {
	encodeCurve,
	encodeGlobal,
	encodeGlobalConfig,
	encodePool,
	fixtureCurve,
	fixtureGlobal,
	fixturePool,
	mintAccount,
	tokenAccount,
} from "./helpers/curves";
import { FakeConnection } from "./helpers/fakeConnection";

let clock: ManualClock;
let conn: FakeConnection;
let chain: PumpChain;

const newMint = (): PublicKey => web3.Keypair.generate().publicKey;

async function addCurve(mint: PublicKey, tokenProgram = splToken.TOKEN_PROGRAM_ID, realQuote = 2_000_000_000) {
	const curve = fixtureCurve({ realQuoteReserves: new BN(realQuote) });
	conn.set(pump.bondingCurvePda(mint), await encodeCurve(curve));
	conn.set(mint, mintAccount(tokenProgram));
	return curve;
}

beforeEach(() => {
	clock = new ManualClock(1_000_000);
	conn = new FakeConnection();
	chain = new PumpChain(conn, new RpcBudget(100, clock), clock);
});

describe("PumpChain curves", () => {
	it("fetches and decodes a bonding curve in one batched call", async () => {
		const mint = newMint();
		const curve = await addCurve(mint);
		const snapshot = await chain.fetchCurve(mint.toBase58());
		expect(snapshot).not.toBeNull();
		expect(snapshot?.curve.virtualTokenReserves.toString()).toBe(curve.virtualTokenReserves.toString());
		expect(snapshot?.curve.virtualQuoteReserves.toString()).toBe(curve.virtualQuoteReserves.toString());
		expect(snapshot?.curve.realQuoteReserves.toString()).toBe("2000000000");
		expect(snapshot?.tokenProgram).toBe("spl");
		expect(snapshot?.slot).toBe(100);
		expect(snapshot?.at).toBe(1_000_000);
		expect(conn.calls).toEqual([
			{
				method: "getMultipleAccountsInfoAndContext",
				keys: [pump.bondingCurvePda(mint).toBase58(), mint.toBase58()],
			},
		]);
	});

	it("returns null when the curve account is missing", async () => {
		expect(await chain.fetchCurve(newMint().toBase58())).toBeNull();
	});

	it("detects Token-2022 mints from the mint account owner", async () => {
		const mint = newMint();
		await addCurve(mint, splToken.TOKEN_2022_PROGRAM_ID);
		expect((await chain.fetchCurve(mint.toBase58()))?.tokenProgram).toBe("token2022");
	});

	it("fetches the pump globals", async () => {
		conn.set(pump.GLOBAL_PDA, await encodeGlobal(fixtureGlobal()));
		const globals = await chain.fetchGlobals();
		expect(globals.global.initialVirtualSolReserves.toString()).toBe("30000000000");
		expect(globals.feeConfig).toBeNull();
	});
});

describe("PumpChain watches", () => {
	it("drops updates at or below the last seen slot", async () => {
		const mint = newMint();
		await addCurve(mint);
		const slots: number[] = [];
		chain.watchCurve(mint.toBase58(), (snapshot) => slots.push(snapshot.slot));
		const pda = pump.bondingCurvePda(mint);
		const info = await encodeCurve(fixtureCurve());
		conn.push(pda, info, 10);
		conn.push(pda, info, 9);
		conn.push(pda, info, 10);
		expect(slots).toEqual([10]);
	});

	it("polls every watched account in one batched call every 2 seconds", async () => {
		const a = newMint();
		const b = newMint();
		await addCurve(a);
		await addCurve(b);
		const seen: string[] = [];
		chain.watchCurve(a.toBase58(), (s) => seen.push(s.mint));
		chain.watchCurve(b.toBase58(), (s) => seen.push(s.mint));
		conn.calls.length = 0;
		await clock.advance(2_000);
		expect(conn.calls).toHaveLength(1);
		expect(conn.calls[0].keys).toEqual(
			expect.arrayContaining([pump.bondingCurvePda(a).toBase58(), pump.bondingCurvePda(b).toBase58()]),
		);
		expect(seen.sort()).toEqual([a.toBase58(), b.toBase58()].sort());
	});

	it("skips a poll tick when the RPC budget is empty", async () => {
		const budget = new RpcBudget(1, clock);
		chain = new PumpChain(conn, budget, clock);
		const mint = newMint();
		await addCurve(mint);
		chain.watchCurve(mint.toBase58(), () => {});
		conn.calls.length = 0;
		await clock.advance(1_999);
		budget.tryTake();
		await clock.advance(1);
		expect(conn.calls).toHaveLength(0);
	});

	it("limits active watches to every position plus every pin and frees a slot on unsubscribe", async () => {
		expect(MAX_WATCHES).toBe(16);
		const stops: (() => void)[] = [];
		for (let i = 0; i < MAX_WATCHES; i++) stops.push(chain.watchCurve(newMint().toBase58(), () => {}));
		expect(() => chain.watchCurve(newMint().toBase58(), () => {})).toThrow(WatchLimitError);
		stops[0]();
		expect(() => chain.watchCurve(newMint().toBase58(), () => {})).not.toThrow();
		expect(conn.listenerCount()).toBe(MAX_WATCHES);
	});
});

describe("PumpChain holders and health", () => {
	it("excludes the bonding curve's token account from holders", async () => {
		const mint = newMint();
		const curveAta = splToken.getAssociatedTokenAddressSync(
			mint,
			pump.bondingCurvePda(mint),
			true,
			splToken.TOKEN_PROGRAM_ID,
		);
		const holder = newMint();
		conn.largest = [
			{ address: curveAta, amount: "793100000000000", decimals: 6, uiAmount: null },
			{ address: holder, amount: "5000000000", decimals: 6, uiAmount: null },
		];
		const summary = await chain.fetchHolders(mint.toBase58(), "spl");
		expect(summary.curveAccount).toBe(curveAta.toBase58());
		expect(summary.supply).toBe(1_000_000_000_000_000n);
		expect(summary.holders).toEqual([{ account: holder.toBase58(), amount: 5_000_000_000n }]);
	});

	it("reports degraded after 3 consecutive RPC errors and recovers on success", async () => {
		const mint = newMint();
		await addCurve(mint);
		conn.failNext = 3;
		for (let i = 0; i < 3; i++) await expect(chain.fetchCurve(mint.toBase58())).rejects.toThrow();
		expect(chain.health()).toEqual({ degraded: true });
		await chain.fetchCurve(mint.toBase58());
		expect(chain.health()).toEqual({ degraded: false });
	});
});

describe("PumpChain pools", () => {
	it("reads pool reserves and quote inputs, caching the AMM configs", async () => {
		const mint = newMint();
		const pool = fixturePool(mint);
		conn.set(swap.canonicalPumpPoolPda(mint), await encodePool(pool));
		conn.set(mint, mintAccount(splToken.TOKEN_PROGRAM_ID));
		conn.set(pool.poolBaseTokenAccount, tokenAccount(mint, pool.poolBaseTokenAccount, 200_000_000_000_000n));
		conn.set(
			pool.poolQuoteTokenAccount,
			tokenAccount(splToken.NATIVE_MINT, pool.poolQuoteTokenAccount, 85_000_000_000n),
		);
		conn.set(swap.GLOBAL_CONFIG_PDA, await encodeGlobalConfig());

		const snapshot = await chain.fetchPool(mint.toBase58());
		expect(snapshot?.baseReserve).toBe(200_000_000_000_000n);
		expect(snapshot?.quoteReserve).toBe(85_000_000_000n);
		expect(snapshot?.quote.baseMint.equals(mint)).toBe(true);
		expect(snapshot?.quote.coinCreator.equals(pool.coinCreator)).toBe(true);
		expect(snapshot?.quote.baseMintAccount.decimals).toBe(6);
		expect(snapshot?.quote.feeConfig).toBeNull();

		const callsBefore = conn.calls.length;
		await chain.fetchPool(mint.toBase58());
		const second = conn.calls.slice(callsBefore).flatMap((call) => call.keys);
		expect(second).not.toContain(swap.GLOBAL_CONFIG_PDA.toBase58());
	});

	it("watches a pool through the batched poll", async () => {
		const mint = newMint();
		const pool = fixturePool(mint);
		conn.set(swap.canonicalPumpPoolPda(mint), await encodePool(pool));
		conn.set(mint, mintAccount(splToken.TOKEN_PROGRAM_ID));
		conn.set(pool.poolBaseTokenAccount, tokenAccount(mint, pool.poolBaseTokenAccount, 200_000_000_000_000n));
		conn.set(
			pool.poolQuoteTokenAccount,
			tokenAccount(splToken.NATIVE_MINT, pool.poolQuoteTokenAccount, 85_000_000_000n),
		);
		conn.set(swap.GLOBAL_CONFIG_PDA, await encodeGlobalConfig());

		const quotes: bigint[] = [];
		chain.watchPool(mint.toBase58(), (snapshot) => quotes.push(snapshot.quoteReserve));
		await clock.advance(0);
		expect(quotes).toEqual([85_000_000_000n]);

		conn.slot = 101;
		conn.set(
			pool.poolQuoteTokenAccount,
			tokenAccount(splToken.NATIVE_MINT, pool.poolQuoteTokenAccount, 90_000_000_000n),
		);
		conn.calls.length = 0;
		await clock.advance(2_000);
		expect(conn.calls).toHaveLength(1);
		expect(conn.calls[0].keys).toEqual([pool.poolBaseTokenAccount.toBase58(), pool.poolQuoteTokenAccount.toBase58()]);
		expect(quotes).toEqual([85_000_000_000n, 90_000_000_000n]);
	});

	it("returns null when the pool does not exist", async () => {
		expect(await chain.fetchPool(newMint().toBase58())).toBeNull();
	});
});
