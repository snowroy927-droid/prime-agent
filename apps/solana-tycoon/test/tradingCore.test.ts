import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import { afterEach, describe, expect, it } from "vitest";
import { EngineBus } from "../src/engine/bus";
import { RpcBudget } from "../src/engine/chain/rpcBudget";
import { web3 } from "../src/engine/chain/solana";
import { ManualClock } from "../src/engine/clock";
import { TradingCore } from "../src/engine/core/tradingCore";
import { Ledger } from "../src/engine/ledger/ledger";
import { PUMP_RISK_COPY, pumpLimits, RiskGuard } from "../src/engine/risk/guard";
import { LaunchHistory } from "../src/engine/scout/launchHistory";
import { Scout } from "../src/engine/scout/scout";
import { SettingsStore } from "../src/engine/settingsStore";
import { PaperExecutor } from "../src/engine/trader/paper";
import type { Ack, Command, EngineEvent } from "../src/shared/protocol";
import type { Launch } from "../src/shared/types";
import { fixtureCurve, fixturePoolSnapshot } from "./helpers/curves";
import { FakeChain } from "./helpers/fakeChain";
import { FakeFeed } from "./helpers/fakeFeed";

const START = Date.UTC(2026, 9, 15, 12, 0);
const SUPPLY = 1_000_000_000_000_000n;

interface Harness {
	core: TradingCore;
	clock: ManualClock;
	chain: FakeChain;
	feed: FakeFeed;
	events: EngineEvent[];
	ledgerPath: string;
}

const dirs: string[] = [];
const cores: TradingCore[] = [];

afterEach(async () => {
	for (const core of cores.splice(0)) await core.stop();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function harness(opts: { budgetPerSec?: number; prepare?: (h: Omit<Harness, "core" | "events">) => void } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "core-"));
	dirs.push(dir);
	const clock = new ManualClock(START);
	const budget = new RpcBudget(opts.budgetPerSec ?? 1_000, clock);
	const chain = new FakeChain(clock, budget);
	const feed = new FakeFeed();
	const ledgerPath = join(dir, "ledger.jsonl");
	opts.prepare?.({ clock, chain, feed, ledgerPath });
	const bus = new EngineBus();
	const events: EngineEvent[] = [];
	bus.on((event) => events.push(event));
	const settings = new SettingsStore(join(dir, "settings.json"), {});
	const history = new LaunchHistory(null, clock);
	let core: TradingCore | null = null;
	const executor = new PaperExecutor({
		mode: "paper",
		chain,
		globals: () => {
			if (!core) throw new Error("core not constructed");
			return core.globals();
		},
		clock,
		settings: () => settings.get(),
	});
	core = new TradingCore({
		mode: "paper",
		synthetic: false,
		feed,
		chain,
		executor,
		ledger: new Ledger(ledgerPath),
		history,
		scout: new Scout({ chain, budget, history, clock, settings: () => settings.get() }),
		risk: new RiskGuard({
			clock,
			limits: () => pumpLimits(settings.get()),
			copy: PUMP_RISK_COPY,
			tzOffsetMin: () => 0,
		}),
		budget,
		clock,
		bus,
		settings,
		publicRpcFallback: false,
		tzOffsetMin: () => 0,
	});
	cores.push(core);
	await core.start();
	return { core, clock, chain, feed, events, ledgerPath };
}

let mintCounter = 0;
function newLaunch(clock: ManualClock, over: Partial<Launch> = {}): Launch {
	mintCounter += 1;
	return {
		mint: web3.Keypair.generate().publicKey.toBase58(),
		name: `Coin ${mintCounter}`,
		symbol: `C${mintCounter}`,
		creator: web3.Keypair.generate().publicKey.toBase58(),
		signature: null,
		uri: null,
		marketCapSol: 28,
		receivedAt: clock.now(),
		...over,
	};
}

function healthyCoin(h: Pick<Harness, "chain">, mint: string, holders = 12): BondingCurve {
	const curve = fixtureCurve({ realQuoteReserves: new BN(1_500_000_000) });
	h.chain.setCurve(mint, curve);
	h.chain.setHolders(mint, {
		supply: SUPPLY,
		curveAccount: "curve",
		holders: Array.from({ length: holders }, (_, i) => ({ account: `h${i}`, amount: SUPPLY / 100n })),
	});
	return curve;
}

function scaledPrice(curve: BondingCurve, factor: number): BondingCurve {
	return {
		...curve,
		virtualQuoteReserves: new BN(Math.round(Number(curve.virtualQuoteReserves.toString()) * factor).toString()),
	};
}

const ofType = <T extends EngineEvent["type"]>(events: EngineEvent[], type: T) =>
	events.filter((event): event is Extract<EngineEvent, { type: T }> => event.type === type);

const ledgerLines = (path: string) =>
	readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { kind: string; side?: string; reason?: string });

async function cmd(core: TradingCore, command: Command): Promise<Ack> {
	return core.handleCommand(command);
}

describe("TradingCore launch flow", () => {
	it("snipes an approved launch and takes profit", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		const curve = healthyCoin(h, launch.mint);
		h.feed.launch(launch);
		await h.clock.advance(2_000);
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(1);

		h.chain.setCurve(launch.mint, scaledPrice(curve, 3));
		await h.clock.advance(800);

		const closes = ofType(h.events, "close");
		expect(closes).toHaveLength(1);
		expect(closes[0].trade.reason).toBe("take_profit");
		expect(h.core.snapshot().positions).toHaveLength(0);

		const lines = ledgerLines(h.ledgerPath);
		expect(lines.map((line) => line.kind)).toEqual(["fill", "fill", "close"]);
		expect(lines.map((line) => line.side ?? line.reason)).toEqual(["buy", "sell", "take_profit"]);

		const order = h.events.map((event) =>
			event.type === "order" ? `order:${event.order.side}:${event.order.status}` : event.type,
		);
		const first = (name: string) => order.indexOf(name);
		expect(first("launch")).toBeLessThan(first("check"));
		expect(first("check")).toBeLessThan(first("order:buy:pending"));
		expect(first("order:buy:pending")).toBeLessThan(first("order:buy:filled"));
		expect(first("order:buy:filled")).toBeLessThan(first("price"));
		expect(first("price")).toBeLessThan(first("order:sell:pending"));
		expect(first("order:sell:filled")).toBeLessThan(first("close"));
		expect(order.slice(first("close"))).toEqual(expect.arrayContaining(["stats", "risk", "balance"]));
	});

	it("stops out a loser and counts it toward tilt", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		const curve = healthyCoin(h, launch.mint);
		h.feed.launch(launch);
		await h.clock.advance(2_800);
		h.chain.setCurve(launch.mint, scaledPrice(curve, 0.5));
		await h.clock.advance(800);
		expect(ofType(h.events, "close")[0]?.trade.reason).toBe("stop_loss");
		expect(h.core.snapshot().risk.tiltLosses).toBe(1);
	});

	it("re-checks a soft rejection and buys once it passes", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint, 5);
		h.feed.launch(launch);
		await h.clock.advance(2_000);
		const firstCheck = ofType(h.events, "check")[0];
		expect(firstCheck.check).toMatchObject({ verdict: "rejected", attempt: 1 });
		healthyCoin(h, launch.mint, 12);
		await h.clock.advance(8_000);
		const second = ofType(h.events, "check")[1];
		expect(second.check).toMatchObject({ verdict: "approved", attempt: 2 });
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(1);
	});

	it("does not re-check a hard rejection", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock, { name: "Rug Pull Inu" });
		healthyCoin(h, launch.mint);
		h.feed.launch(launch);
		await h.clock.advance(40_000);
		expect(ofType(h.events, "check")).toHaveLength(1);
		expect(h.core.snapshot().positions).toHaveLength(0);
	});

	it("degrades to unchecked under a launch burst instead of buying blind", async () => {
		const h = await harness({ budgetPerSec: 5 });
		const launches = Array.from({ length: 20 }, () => newLaunch(h.clock));
		for (const launch of launches) {
			healthyCoin(h, launch.mint);
			h.feed.launch(launch);
		}
		await h.clock.advance(2_000);
		const checks = ofType(h.events, "check").map((event) => event.check);
		const unchecked = checks.filter((check) => check.verdict === "unchecked");
		expect(unchecked.length).toBeGreaterThanOrEqual(15);
		await h.clock.advance(800);
		const bought = new Set(ofType(h.events, "order").map((event) => event.order.mint));
		for (const check of unchecked) expect(bought.has(check.mint)).toBe(false);
		expect(h.core.snapshot().launches.length).toBeLessThanOrEqual(50);
	});

	it("keeps only the newest 50 launches on the radar", async () => {
		const h = await harness({ budgetPerSec: 1 });
		for (let i = 0; i < 60; i++) h.feed.launch(newLaunch(h.clock));
		const radar = h.core.snapshot().launches;
		expect(radar).toHaveLength(50);
		expect(radar[0].launch.symbol).toBe(`C${mintCounter}`);
	});
});

describe("TradingCore commands", () => {
	it("refuses a second snipe on the same mint while the first is pending", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint);
		const first = cmd(h.core, { type: "snipe", id: "a", mint: launch.mint });
		const second = cmd(h.core, { type: "snipe", id: "b", mint: launch.mint });
		const acks = await Promise.all([first, second]);
		expect(acks).toEqual([
			{ type: "ack", id: "a", ok: true },
			{ type: "ack", id: "b", ok: false, error: "Order already pending" },
		]);
		await h.clock.advance(800);
		const buys = ledgerLines(h.ledgerPath).filter((line) => line.side === "buy");
		expect(buys).toHaveLength(1);
		expect(await cmd(h.core, { type: "snipe", id: "c", mint: launch.mint })).toMatchObject({
			ok: false,
			error: "Already holding",
		});
	});

	it("rejects an invalid settings patch and keeps the old settings", async () => {
		const h = await harness();
		const before = h.core.snapshot().settings;
		const ack = await cmd(h.core, { type: "setSettings", id: "s", patch: { takeProfitPct: -5 } });
		expect(ack.ok).toBe(false);
		expect(ack.error).toContain("takeProfitPct");
		expect(h.core.snapshot().settings).toEqual(before);
		const good = await cmd(h.core, { type: "setSettings", id: "t", patch: { takeProfitPct: 50 } });
		expect(good.ok).toBe(true);
		expect(h.core.snapshot().settings.takeProfitPct).toBe(50);
		expect(ofType(h.events, "settings").at(-1)?.settings.takeProfitPct).toBe(50);
	});

	it("sells half and keeps the position open, then refuses sells without a position", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint);
		await cmd(h.core, { type: "snipe", id: "a", mint: launch.mint });
		await h.clock.advance(800);
		const tokens = BigInt(h.core.snapshot().positions[0].tokenAmount);
		expect((await cmd(h.core, { type: "sell", id: "b", mint: launch.mint, pct: 50 })).ok).toBe(true);
		await h.clock.advance(800);
		const position = h.core.snapshot().positions[0];
		expect(BigInt(position.tokenAmount)).toBe(tokens - tokens / 2n);
		expect(BigInt(position.proceedsLamports)).toBeGreaterThan(0n);
		expect(
			await cmd(h.core, { type: "sell", id: "c", mint: web3.Keypair.generate().publicKey.toBase58(), pct: 100 }),
		).toMatchObject({
			ok: false,
			error: "No open position",
		});
	});

	it("enforces the paper balance", async () => {
		const h = await harness();
		await cmd(h.core, { type: "setSettings", id: "s", patch: { buySol: 1, maxPositions: 5 } });
		const a = newLaunch(h.clock);
		const b = newLaunch(h.clock);
		healthyCoin(h, a.mint);
		healthyCoin(h, b.mint);
		expect((await cmd(h.core, { type: "snipe", id: "a", mint: a.mint })).ok).toBe(true);
		await h.clock.advance(800);
		expect(await cmd(h.core, { type: "snipe", id: "b", mint: b.mint })).toMatchObject({
			ok: false,
			error: "Insufficient paper balance",
		});
	});

	it("pins coins up to the six hotbar slots", async () => {
		const h = await harness();
		for (let i = 0; i < 6; i++) {
			const ack = await cmd(h.core, {
				type: "pin",
				id: `p${i}`,
				mint: web3.Keypair.generate().publicKey.toBase58(),
			});
			expect(ack.ok).toBe(true);
		}
		expect(
			await cmd(h.core, { type: "pin", id: "x", mint: web3.Keypair.generate().publicKey.toBase58() }),
		).toMatchObject({ ok: false, error: "Hotbar full (6 pins)" });
		const pinned = h.core.snapshot().pinned;
		expect(pinned).toHaveLength(6);
		expect((await cmd(h.core, { type: "unpin", id: "u", mint: pinned[0] })).ok).toBe(true);
		expect(h.core.snapshot().pinned).toHaveLength(5);
	});

	it("still prices and exits every position with the hotbar full and ten positions open", async () => {
		const h = await harness();
		expect((await cmd(h.core, { type: "setSettings", id: "s", patch: { maxPositions: 10 } })).ok).toBe(true);
		for (let i = 0; i < 6; i++) {
			await cmd(h.core, { type: "pin", id: `p${i}`, mint: web3.Keypair.generate().publicKey.toBase58() });
		}
		const coins = Array.from({ length: 10 }, () => {
			const launch = newLaunch(h.clock);
			return { mint: launch.mint, curve: healthyCoin(h, launch.mint) };
		});
		for (const coin of coins) await cmd(h.core, { type: "snipe", id: coin.mint, mint: coin.mint });
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(10);
		for (const coin of coins) h.chain.setCurve(coin.mint, scaledPrice(coin.curve, 3));
		await h.clock.advance(800);
		expect(ofType(h.events, "close").map((event) => event.trade.reason)).toEqual(Array(10).fill("take_profit"));
	});

	it("kill sells every position and pauses the engine", async () => {
		const h = await harness();
		const a = newLaunch(h.clock);
		const b = newLaunch(h.clock);
		healthyCoin(h, a.mint);
		healthyCoin(h, b.mint);
		await cmd(h.core, { type: "snipe", id: "a", mint: a.mint });
		await cmd(h.core, { type: "snipe", id: "b", mint: b.mint });
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(2);
		expect((await cmd(h.core, { type: "kill", id: "k" })).ok).toBe(true);
		await h.clock.advance(800);
		const snapshot = h.core.snapshot();
		expect(snapshot.positions).toHaveLength(0);
		expect(snapshot.risk).toMatchObject({ paused: true, pausedReason: "Kill switch" });
		expect(ofType(h.events, "close").map((event) => event.trade.reason)).toEqual(["kill", "kill"]);
		expect(await cmd(h.core, { type: "snipe", id: "c", mint: a.mint })).toMatchObject({
			ok: false,
			error: "Engine paused",
		});
		expect((await cmd(h.core, { type: "resume", id: "r" })).ok).toBe(true);
		expect(h.core.snapshot().risk.paused).toBe(false);
	});
});

describe("TradingCore kill switch", () => {
	it("sells a buy that was still in flight when the kill landed", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint);
		await cmd(h.core, { type: "snipe", id: "a", mint: launch.mint });
		expect((await cmd(h.core, { type: "kill", id: "k" })).ok).toBe(true);
		await h.clock.advance(800);
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(0);
		expect(ofType(h.events, "close").map((event) => event.trade.reason)).toEqual(["kill"]);
	});

	it("sells the rest of a position whose partial sell was pending at the kill", async () => {
		const h = await harness();
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint);
		await cmd(h.core, { type: "snipe", id: "a", mint: launch.mint });
		await h.clock.advance(800);
		expect((await cmd(h.core, { type: "sell", id: "s", mint: launch.mint, pct: 50 })).ok).toBe(true);
		expect((await cmd(h.core, { type: "kill", id: "k" })).ok).toBe(true);
		await h.clock.advance(800);
		await h.clock.advance(800);
		expect(h.core.snapshot().positions).toHaveLength(0);
		expect(ofType(h.events, "close").map((event) => event.trade.reason)).toEqual(["kill"]);
	});

	it("stops selling new fills once the engine is resumed", async () => {
		const h = await harness();
		await cmd(h.core, { type: "kill", id: "k" });
		await cmd(h.core, { type: "resume", id: "r" });
		const launch = newLaunch(h.clock);
		healthyCoin(h, launch.mint);
		await cmd(h.core, { type: "snipe", id: "a", mint: launch.mint });
		await h.clock.advance(1_600);
		expect(h.core.snapshot().positions).toHaveLength(1);
	});
});

describe("TradingCore serial launchers", () => {
	it("counts a creator's launches even when an earlier check never reached the chain", async () => {
		const h = await harness();
		const creator = web3.Keypair.generate().publicKey.toBase58();
		const first = newLaunch(h.clock, { creator });
		healthyCoin(h, first.mint);
		h.chain.fetchCurveError = new Error("429 Too Many Requests");
		h.feed.launch(first);
		await h.clock.advance(2_000);
		expect(ofType(h.events, "check")[0].check.verdict).toBe("unchecked");
		h.chain.fetchCurveError = null;
		for (const delay of [5_000, 5_000]) {
			await h.clock.advance(delay);
			const next = newLaunch(h.clock, { creator });
			healthyCoin(h, next.mint);
			h.feed.launch(next);
		}
		await h.clock.advance(2_000);
		const third = ofType(h.events, "check").at(-1)?.check;
		expect(third).toMatchObject({ verdict: "rejected", reason: "Serial launcher: 3 coins in 60m" });
		await h.clock.advance(800);
		expect(ofType(h.events, "order").some((event) => event.order.mint === third?.mint)).toBe(false);
	});
});

describe("TradingCore restart", () => {
	const openLot = (ledgerPath: string, mint: string) => {
		new Ledger(ledgerPath).appendFill({
			id: "f1",
			positionId: "p1",
			mode: "paper",
			mint,
			symbol: "OLD",
			side: "buy",
			solLamports: "50000000",
			tokenAmount: "1000000000000",
			feesLamports: "2544280",
			ts: START - 60_000,
		});
	};

	it("resumes a migrated position on its pool", async () => {
		const mint = web3.Keypair.generate().publicKey;
		const h = await harness({
			prepare: ({ chain, ledgerPath }) => {
				openLot(ledgerPath, mint.toBase58());
				chain.setCurve(mint.toBase58(), fixtureCurve({ complete: true }));
				// Priced near the lot's cost so no exit fires on resume.
				chain.setPool(mint.toBase58(), fixturePoolSnapshot(mint, 200_000_000_000_000n, 10_500_000_000n));
			},
		});
		const [position] = h.core.snapshot().positions;
		expect(position).toMatchObject({ id: "p1", migrated: true, stale: false });
		expect(position.valueLamports).not.toBeNull();
	});

	it("starts a position with no price source as stale", async () => {
		const mint = web3.Keypair.generate().publicKey;
		const h = await harness({ prepare: ({ ledgerPath }) => openLot(ledgerPath, mint.toBase58()) });
		expect(h.core.snapshot().positions[0]).toMatchObject({ id: "p1", stale: true, valueLamports: null });
	});

	it("reports skipped ledger lines as log events", async () => {
		const h = await harness({
			prepare: ({ ledgerPath }) => {
				new Ledger(ledgerPath).reset();
				writeFileSync(ledgerPath, "garbage\n");
			},
		});
		expect(ofType(h.events, "log").map((event) => event.line.message)).toContain("Skipped malformed ledger line 1");
	});
});
