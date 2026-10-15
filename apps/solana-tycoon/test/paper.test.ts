import { beforeEach, describe, expect, it } from "vitest";
import { pump, web3 } from "../src/engine/chain/solana";
import { ManualClock } from "../src/engine/clock";
import type { FillResult } from "../src/engine/trader/executor";
import { PaperExecutor } from "../src/engine/trader/paper";
import { quoteBuyTokens, quotePoolSellLamports, quoteSellLamports } from "../src/engine/trader/quote";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { BASE_FEE_LAMPORTS, haircut, solToLamports, TOKEN_ACCOUNT_RENT_LAMPORTS } from "../src/shared/units";
import { fixtureCurve, fixturePoolSnapshot } from "./helpers/curves";
import { FakeChain } from "./helpers/fakeChain";

const MINT = web3.Keypair.generate().publicKey;
let clock: ManualClock;
let chain: FakeChain;
let paper: PaperExecutor;

beforeEach(() => {
	clock = new ManualClock(10_000);
	chain = new FakeChain(clock);
	paper = new PaperExecutor({
		mode: "paper",
		chain,
		globals: () => chain.globals,
		clock,
		settings: () => DEFAULT_SETTINGS,
	});
	chain.setCurve(MINT.toBase58(), fixtureCurve());
});

const buy = () => paper.buy({ positionId: "p1", mint: MINT.toBase58(), symbol: "ZORP", solLamports: 50_000_000n });

describe("PaperExecutor buys", () => {
	it("fills only after the configured latency", async () => {
		let result: FillResult | null = null;
		void buy().then((r) => {
			result = r;
		});
		await clock.advance(799);
		expect(result).toBeNull();
		await clock.advance(1);
		expect(result).not.toBeNull();
	});

	it("records haircut tokens and buy fees", async () => {
		const pending = buy();
		await clock.advance(800);
		const result = await pending;
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const snapshot = await chain.fetchCurve(MINT.toBase58());
		if (!snapshot) throw new Error("fixture curve missing");
		const expectedTokens = haircut(quoteBuyTokens(snapshot, chain.globals, 50_000_000n), 300);
		expect(result.fill).toMatchObject({
			positionId: "p1",
			mode: "paper",
			mint: MINT.toBase58(),
			symbol: "ZORP",
			side: "buy",
			solLamports: "50000000",
			tokenAmount: expectedTokens.toString(),
			feesLamports: (BASE_FEE_LAMPORTS + solToLamports(0.0005) + TOKEN_ACCOUNT_RENT_LAMPORTS).toString(),
			ts: 10_800,
		});
		expect(result.fill.id).not.toBe("");
	});

	it("fails when the coin migrates during the latency", async () => {
		const pending = buy();
		chain.setCurve(MINT.toBase58(), fixtureCurve({ complete: true }));
		await clock.advance(800);
		expect(await pending).toEqual({ ok: false, error: "Coin migrated before fill" });
	});

	it("fails when the curve is missing or the buy exceeds remaining supply", async () => {
		chain.setCurve(MINT.toBase58(), null);
		const missing = buy();
		await clock.advance(800);
		expect(await missing).toEqual({ ok: false, error: "Curve not found" });

		chain.setCurve(
			MINT.toBase58(),
			fixtureCurve({
				realTokenReserves: pump.newBondingCurve(chain.globals.global).realTokenReserves.divn(1_000_000),
			}),
		);
		const huge = paper.buy({ positionId: "p2", mint: MINT.toBase58(), symbol: "ZORP", solLamports: 20_000_000_000n });
		await clock.advance(800);
		expect(await huge).toEqual({ ok: false, error: "Buy exceeds remaining curve supply" });
	});

	it("turns an RPC failure into a failed fill", async () => {
		chain.fetchCurveError = new Error("429 Too Many Requests");
		const pending = buy();
		await clock.advance(800);
		expect(await pending).toEqual({ ok: false, error: "429 Too Many Requests" });
	});
});

describe("PaperExecutor sells", () => {
	const sell = () =>
		paper.sell({ positionId: "p1", mint: MINT.toBase58(), symbol: "ZORP", tokenAmount: 1_000_000_000n });

	it("sells on the curve with haircut proceeds and sell fees", async () => {
		const pending = sell();
		await clock.advance(800);
		const result = await pending;
		const snapshot = await chain.fetchCurve(MINT.toBase58());
		if (!snapshot || !result.ok) throw new Error("expected a filled sell");
		expect(result.fill.side).toBe("sell");
		expect(result.fill.solLamports).toBe(
			haircut(quoteSellLamports(snapshot, chain.globals, 1_000_000_000n), 300).toString(),
		);
		expect(result.fill.feesLamports).toBe((BASE_FEE_LAMPORTS + solToLamports(0.0005)).toString());
	});

	it("sells into the pool after migration", async () => {
		chain.setCurve(MINT.toBase58(), fixtureCurve({ complete: true }));
		const pool = fixturePoolSnapshot(MINT);
		chain.setPool(MINT.toBase58(), pool);
		const pending = sell();
		await clock.advance(800);
		const result = await pending;
		if (!result.ok) throw new Error(result.error);
		expect(result.fill.solLamports).toBe(haircut(quotePoolSellLamports(pool, 1_000_000_000n), 300).toString());
	});

	it("fails without a curve or a pool", async () => {
		chain.setCurve(MINT.toBase58(), null);
		const pending = sell();
		await clock.advance(800);
		expect(await pending).toEqual({ ok: false, error: "No price source" });
	});
});
