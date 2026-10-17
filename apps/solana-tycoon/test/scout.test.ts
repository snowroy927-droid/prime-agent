import BN from "bn.js";
import { beforeEach, describe, expect, it } from "vitest";
import { RpcBudget } from "../src/engine/chain/rpcBudget";
import { web3 } from "../src/engine/chain/solana";
import { ManualClock } from "../src/engine/clock";
import { LaunchHistory } from "../src/engine/scout/launchHistory";
import { Scout } from "../src/engine/scout/scout";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import type { Launch } from "../src/shared/types";
import { fixtureCurve } from "./helpers/curves";
import { FakeChain } from "./helpers/fakeChain";

const SUPPLY = 1_000_000_000_000_000n;
let clock: ManualClock;
let chain: FakeChain;
let budget: RpcBudget;
let scout: Scout;

const launch = (creator: string | null = "Creator111", receivedAt = 0): Launch => ({
	mint: web3.Keypair.generate().publicKey.toBase58(),
	name: "Zorp Coin",
	symbol: "ZORP",
	creator,
	signature: null,
	uri: null,
	marketCapSol: null,
	receivedAt,
});

function listCoin(l: Launch): void {
	chain.setCurve(l.mint, fixtureCurve({ realQuoteReserves: new BN(1_500_000_000) }));
	chain.setHolders(l.mint, {
		supply: SUPPLY,
		curveAccount: "curve",
		holders: Array.from({ length: 12 }, (_, i) => ({ account: `h${i}`, amount: SUPPLY / 100n })),
	});
}

beforeEach(() => {
	clock = new ManualClock(0);
	chain = new FakeChain(clock);
	budget = new RpcBudget(10, clock);
	scout = new Scout({
		chain,
		budget,
		history: new LaunchHistory(null, clock),
		clock,
		settings: () => DEFAULT_SETTINGS,
	});
});

describe("Scout", () => {
	it("approves a clean coin", async () => {
		const l = launch();
		listCoin(l);
		const check = await scout.check(l, 1);
		expect(check).toMatchObject({ mint: l.mint, verdict: "approved", reason: "All checks passed", attempt: 1 });
		expect(check.results).toHaveLength(8);
	});

	it("returns unchecked when the RPC budget is empty", async () => {
		while (budget.tryTake()) {}
		const l = launch();
		listCoin(l);
		expect(await scout.check(l, 1)).toMatchObject({
			verdict: "unchecked",
			reason: "RPC budget exhausted",
			results: [],
		});
	});

	it("rejects a launch whose curve is missing", async () => {
		expect(await scout.check(launch(), 1)).toMatchObject({ verdict: "rejected", reason: "Curve not found" });
	});

	it("keeps going with holders unavailable when the holder fetch fails", async () => {
		const l = launch();
		listCoin(l);
		chain.fetchHolders = async () => {
			throw new Error("rate limited");
		};
		const check = await scout.check(l, 1);
		expect(check.verdict).toBe("rejected");
		expect(check.reason).toBe("Holder data unavailable");
	});

	it("counts the creator from the curve when the launch has none, once per mint", async () => {
		const creator = web3.Keypair.generate().publicKey;
		const coins = [launch(null), launch(null), launch(null)];
		for (const coin of coins)
			chain.setCurve(coin.mint, fixtureCurve({ creator, realQuoteReserves: new BN(1_500_000_000) }));
		await scout.check(coins[0], 1);
		await scout.check(coins[0], 2);
		await scout.check(coins[1], 1);
		const third = await scout.check(coins[2], 1);
		expect(third.results.find((r) => r.rule === "serial_launcher")).toMatchObject({
			pass: false,
			reason: "Serial launcher: 3 coins in 60m",
		});
	});
});
