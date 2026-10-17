import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineBus } from "../src/engine/bus";
import { web3 } from "../src/engine/chain/solana";
import { ManualClock } from "../src/engine/clock";
import { Engine } from "../src/engine/core/engine";
import type { EngineEvent } from "../src/shared/protocol";
import { buildKrakenDesk } from "./helpers/krakenDesk";
import { buildPumpCore, healthyCoin } from "./helpers/pumpCore";

const NOW = Date.UTC(2026, 9, 15, 12, 0);
const dirs: string[] = [];
const engines: Engine[] = [];

afterEach(async () => {
	for (const engine of engines.splice(0)) await engine.stop();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function rig(opts: { kraken: boolean }) {
	const dir = mkdtempSync(join(tmpdir(), "engine-"));
	dirs.push(dir);
	const clock = new ManualClock(NOW);
	const bus = new EngineBus();
	const events: EngineEvent[] = [];
	bus.on((event) => events.push(event));
	const pump = buildPumpCore({ dir, clock, bus });
	const kraken = opts.kraken ? buildKrakenDesk({ dir, clock, emit: (event) => bus.emit(event) }) : null;
	const engine = new Engine(pump.core, kraken?.desk ?? null, { bus, clock });
	engines.push(engine);
	return { clock, events, pump, kraken, engine };
}

function withKraken() {
	const h = rig({ kraken: true });
	const { kraken } = h;
	if (!kraken) throw new Error("expected a Kraken desk");
	return { ...h, kraken };
}

const mint = () => web3.Keypair.generate().publicKey.toBase58();

describe("Engine", () => {
	it("starts pump.fun when the Kraken desk fails to start and shows the desk offline", async () => {
		const h = withKraken();
		h.kraken.rest.assetPairsError = new Error("fetch failed");
		await h.engine.start();
		await h.engine.krakenSettled();

		const snapshot = h.engine.snapshot();
		expect(snapshot.feed.status).toBe("live");
		expect(snapshot.risk.paused).toBe(false);
		expect(snapshot.kraken?.error).toBe("fetch failed");
		expect(h.events).toContainEqual({ type: "kraken_offline", error: "fetch failed" });
		expect(h.events).toContainEqual({
			type: "log",
			line: { level: "error", message: "Kraken: desk offline (fetch failed)", at: NOW },
		});
		expect(await h.engine.handleCommand({ type: "kraken_pin", id: "p", pair: "MOONUSD" })).toEqual({
			type: "ack",
			id: "p",
			ok: false,
			error: "Kraken desk is offline",
		});

		const coin = mint();
		healthyCoin(h.pump, coin);
		expect(await h.engine.handleCommand({ type: "snipe", id: "s", mint: coin })).toEqual({
			type: "ack",
			id: "s",
			ok: true,
		});
		await h.clock.advance(800);
		expect(h.engine.snapshot().positions.map((position) => position.mint)).toEqual([coin]);
	});

	it("serves pump.fun while the Kraken start is still waiting on the network", async () => {
		const h = withKraken();
		h.kraken.rest.assetPairsHang = new Promise<void>(() => undefined);
		await h.engine.start();
		const snapshot = h.engine.snapshot();
		expect(snapshot.feed.status).toBe("live");
		expect(snapshot.kraken).toMatchObject({ error: null, feed: { status: "connecting" } });
		const coin = mint();
		healthyCoin(h.pump, coin);
		expect((await h.engine.handleCommand({ type: "snipe", id: "s", mint: coin })).ok).toBe(true);
		await h.clock.advance(800);
	});

	it("retries a failed Kraken start in the background and brings the desk online", async () => {
		const h = withKraken();
		h.kraken.rest.assetPairsError = new Error("fetch failed");
		await h.engine.start();
		await h.engine.krakenSettled();
		expect(h.engine.snapshot().kraken?.error).toBe("fetch failed");
		h.kraken.rest.assetPairsError = null;
		await h.clock.advance(30_000);
		await h.engine.krakenSettled();
		expect(h.engine.snapshot().kraken?.error).toBeNull();
		expect(h.events.filter((event) => event.type === "snapshot")).toHaveLength(1);
		expect(h.events).toContainEqual({
			type: "log",
			line: { level: "info", message: "Kraken: desk online", at: NOW + 30_000 },
		});
		expect((await h.engine.handleCommand({ type: "kraken_pin", id: "p", pair: "MOONUSD" })).ok).toBe(true);
	});

	it("keeps pump.fun running when the Kraken desk could not be built, and shows why", async () => {
		const dir = mkdtempSync(join(tmpdir(), "engine-"));
		dirs.push(dir);
		const clock = new ManualClock(NOW);
		const bus = new EngineBus();
		const pump = buildPumpCore({ dir, clock, bus });
		const failure = "Settings file data/settings-kraken-paper.json is not valid JSON";
		const engine = new Engine(pump.core, null, { bus, clock, krakenFailure: failure });
		engines.push(engine);
		await engine.start();
		expect(engine.snapshot().feed.status).toBe("live");
		expect(engine.snapshot().kraken).toMatchObject({ error: failure, movers: [], positions: [] });
		expect(await engine.handleCommand({ type: "kraken_buy", id: "b", pair: "MOONUSD" })).toEqual({
			type: "ack",
			id: "b",
			ok: false,
			error: "Kraken desk is offline",
		});
	});

	it("kill sells every position on both desks, including buys still in flight, and pauses both until resume", async () => {
		const h = withKraken();
		await h.engine.start();
		await h.engine.krakenSettled();
		const held = mint();
		const late = mint();
		healthyCoin(h.pump, held);
		healthyCoin(h.pump, late);
		h.kraken.ticker("MOON", "1.000", "1.001");
		h.kraken.ticker("WIDE", "2.000", "2.002");

		expect((await h.engine.handleCommand({ type: "snipe", id: "p1", mint: held })).ok).toBe(true);
		const buy = { type: "kraken_buy", id: "k1", pair: "MOONUSD", holdConfirmed: true } as const;
		expect(await h.engine.handleCommand(buy)).toEqual({ type: "ack", id: "k1", ok: true });
		await h.clock.advance(800);
		expect(h.engine.snapshot().positions).toHaveLength(1);
		expect(h.engine.snapshot().kraken?.positions).toHaveLength(1);

		expect((await h.engine.handleCommand({ type: "snipe", id: "p2", mint: late })).ok).toBe(true);
		const lateBuy = { type: "kraken_buy", id: "k2", pair: "WIDEUSD", holdConfirmed: true } as const;
		expect((await h.engine.handleCommand(lateBuy)).ok).toBe(true);
		expect(await h.engine.handleCommand({ type: "kill", id: "kill" })).toEqual({ type: "ack", id: "kill", ok: true });
		await h.clock.advance(800);
		await h.clock.advance(800);

		const snapshot = h.engine.snapshot();
		expect(snapshot.positions).toEqual([]);
		expect(snapshot.kraken?.positions).toEqual([]);
		const reasons = (type: "close" | "kraken_close") =>
			h.events.flatMap((event) =>
				event.type === type && (event.type === "close" || event.type === "kraken_close")
					? [event.trade.reason]
					: [],
			);
		expect(reasons("close")).toEqual(["kill", "kill"]);
		expect(reasons("kraken_close")).toEqual(["kill", "kill"]);
		expect(snapshot.risk).toMatchObject({ paused: true, pausedReason: "Kill switch" });
		expect(snapshot.kraken?.risk).toMatchObject({ paused: true, pausedReason: "Kill switch" });

		expect((await h.engine.handleCommand({ type: "resume", id: "r" })).ok).toBe(true);
		expect(h.engine.snapshot().risk.paused).toBe(false);
		expect(h.engine.snapshot().kraken?.risk.paused).toBe(false);
	});

	it("keeps pause and resume on their own desk outside a kill", async () => {
		const h = withKraken();
		await h.engine.start();
		await h.engine.krakenSettled();
		await h.engine.handleCommand({ type: "kraken_pause", id: "kp" });
		await h.engine.handleCommand({ type: "pause", id: "pp" });
		await h.engine.handleCommand({ type: "resume", id: "pr" });
		expect(h.engine.snapshot().risk.paused).toBe(false);
		expect(h.engine.snapshot().kraken?.risk).toMatchObject({ paused: true, pausedReason: "Paused by you" });
		expect(await h.engine.handleCommand({ type: "kraken_buy", id: "x", pair: "NOPEUSD" })).toEqual({
			type: "ack",
			id: "x",
			ok: false,
			error: "Unknown pair",
		});
	});

	it("answers Kraken commands with an error when the desk is off", async () => {
		const h = rig({ kraken: false });
		await h.engine.start();
		expect(await h.engine.handleCommand({ type: "kraken_buy", id: "b", pair: "MOONUSD" })).toEqual({
			type: "ack",
			id: "b",
			ok: false,
			error: "Kraken desk is off",
		});
		expect(h.engine.snapshot().kraken).toBeNull();
		expect((await h.engine.handleCommand({ type: "kill", id: "k" })).ok).toBe(true);
		expect(h.engine.snapshot().risk.paused).toBe(true);
	});
});
