import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Clock, ManualClock, ScaledClock } from "../src/engine/clock";
import { assembleKrakenDesk } from "../src/engine/kraken/assemble";
import type { KrakenFeedEvent } from "../src/engine/kraken/feed";
import type { PairUniverse } from "../src/engine/kraken/pairs";
import { ReplayKrakenSource } from "../src/engine/kraken/replay";
import { KrakenRestError } from "../src/engine/kraken/rest";
import { buildKrakenDemo, KRAKEN_DEMO_DESCRIPTION } from "../src/engine/kraken/synthetic";
import { Recorder } from "../src/engine/replay/recorder";
import { readRecording } from "../src/engine/replay/recording";
import type { KrakenEvent } from "../src/shared/kraken";
import { FakeKrakenRest, usdPair } from "./helpers/fakeKraken";

const START = Date.UTC(2026, 9, 15, 12, 0);
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "kreplay-"));
	dirs.push(dir);
	return dir;
}

async function runKrakenDemo(speed = 1) {
	const dir = tempDir();
	const base = new ManualClock(START);
	const clock: Clock = speed === 1 ? base : new ScaledClock(base, speed);
	let universe: PairUniverse | null = null;
	const source = new ReplayKrakenSource(buildKrakenDemo(7), clock, () => universe);
	const events: KrakenEvent[] = [];
	const assembled = assembleKrakenDesk({
		mode: "demo",
		synthetic: source.synthetic,
		feed: source,
		rest: source,
		clock,
		settingsPath: join(dir, "settings-kraken.json"),
		ledgerPath: join(dir, "ledger-kraken.jsonl"),
		emit: (event) => events.push(event),
		tzOffsetMin: () => 0,
	});
	universe = assembled.universe;
	await assembled.desk.start();
	for (let second = 0; second < 205; second++) await base.advance(1_000 / speed);
	const snapshot = assembled.desk.snapshot();
	await assembled.desk.stop();
	return { events, snapshot, synthetic: source.synthetic };
}

const closesOf = (events: KrakenEvent[]) =>
	events.flatMap((event) => (event.type === "kraken_close" ? [`${event.trade.symbol}:${event.trade.reason}`] : []));

describe("Kraken synthetic demo", () => {
	it("is deterministic for a seed and labelled synthetic", () => {
		const lines = buildKrakenDemo(7);
		expect(JSON.stringify(buildKrakenDemo(7))).toBe(JSON.stringify(lines));
		expect(KRAKEN_DEMO_DESCRIPTION).toContain("SYNTHETIC DEMO");
		expect(lines[0]).toMatchObject({ t: 0, kind: "meta", synthetic: true, description: KRAKEN_DEMO_DESCRIPTION });
		expect(Math.max(...lines.map((line) => line.t))).toBeLessThanOrEqual(200_000);
	});

	it("plays every scripted beat through the real Kraken desk", async () => {
		const { events, snapshot, synthetic } = await runKrakenDemo();
		expect(synthetic).toBe(true);
		expect(closesOf(events)).toEqual(["MOONCAT:take_profit", "RUGDOG:stop_loss"]);

		const buys = events.flatMap((event) =>
			event.type === "kraken_order" && event.order.side === "buy" && event.order.status === "pending"
				? [[event.order.symbol, event.order.at - START]]
				: [],
		);
		expect(buys.map(([symbol]) => symbol)).toEqual(["MOONCAT", "RUGDOG", "HALTY"]);
		const at = new Map(buys.map(([symbol, ms]) => [symbol, Number(ms)]));
		expect(at.get("MOONCAT")).toBeGreaterThanOrEqual(18_000);
		expect(at.get("MOONCAT")).toBeLessThanOrEqual(25_000);
		expect(at.get("RUGDOG")).toBeGreaterThanOrEqual(48_000);
		expect(at.get("RUGDOG")).toBeLessThanOrEqual(55_000);
		expect(at.get("HALTY")).toBeGreaterThanOrEqual(78_000);
		expect(at.get("HALTY")).toBeLessThanOrEqual(85_000);

		expect(snapshot.positions).toMatchObject([{ symbol: "HALTY", halted: true }]);
		expect(snapshot.scanStats.skipReasons).toContainEqual({ reason: "Wide spread", count: 1 });
		expect(snapshot.movers.find((mover) => mover.symbol === "WIDEBOI")?.status).toBe("wide_spread");

		const feed = events.flatMap((event) => (event.type === "kraken_feed" ? [event] : []));
		const down = feed.find((event) => event.status === "down");
		expect(down?.reconnectAt).toBe(START + 108_000);
		expect(feed.at(-1)?.status).toBe("live");

		expect(Number(snapshot.solUsd?.price)).toBeGreaterThan(140);
		expect(Number(snapshot.solUsd?.price)).toBeLessThan(160);
	});

	it("closes the same trades at speed 4", async () => {
		const atFour = await runKrakenDemo(4);
		expect(closesOf(atFour.events)).toEqual(["MOONCAT:take_profit", "RUGDOG:stop_loss"]);
		expect(atFour.snapshot.positions).toMatchObject([{ symbol: "HALTY", halted: true }]);
	});
});

describe("ReplayKrakenSource", () => {
	it("throws Not in recording for an unrecorded OHLC query", async () => {
		const source = new ReplayKrakenSource(buildKrakenDemo(7), new ManualClock(START), () => null);
		const call = source.ohlc("NOPEUSD");
		await expect(call).rejects.toBeInstanceOf(KrakenRestError);
		await expect(call).rejects.toThrow("Not in recording");
	});

	it("replays recorded REST bodies, raw messages and feed status shifted onto the replay clock", async () => {
		const file = join(tempDir(), "recordings", "session.jsonl");
		const clock = new ManualClock(START);
		const recorder = new Recorder(file, clock);
		const fake = new FakeKrakenRest();
		fake.pairs = { MOONUSD: usdPair("MOON") };
		fake.candles.set("MOONUSD", [[START / 1000 - 60, "1", "1", "1", "1", "1", "5", 3]]);
		const rest = recorder.wrapKrakenRest(fake);
		expect(await rest.assetPairs()).toEqual(fake.pairs);
		await clock.advance(1_000);
		await rest.ohlc("MOONUSD");
		recorder.krakenRaw(
			JSON.stringify({
				channel: "ticker",
				type: "update",
				data: [{ symbol: "MOON/USD", bid: 1, ask: 1.01, last: 1, volume: 1000, vwap: 1 }],
			}),
		);
		await clock.advance(500);
		recorder.krakenRaw(
			JSON.stringify({
				channel: "ohlc",
				type: "update",
				data: [
					{ symbol: "MOON/USD", close: 1, volume: 5, interval_begin: new Date(START).toISOString(), interval: 1 },
				],
			}),
		);
		recorder.krakenFeedStatus("down");
		recorder.krakenFeedStatus("down");

		const lines = readRecording(file);
		expect(lines.map((line) => [line.kind, line.t])).toEqual([
			["meta", 0],
			["kraken_rest", 0],
			["kraken_rest", 1_000],
			["kraken_ws", 1_000],
			["kraken_ws", 1_500],
			["kraken_feed", 1_500],
		]);

		const shift = 3_600_000;
		const replayClock = new ManualClock(START + shift);
		const source = new ReplayKrakenSource(lines, replayClock, () => null);
		expect(source.synthetic).toBe(false);
		expect(await source.assetPairs()).toEqual(fake.pairs);
		expect(await source.ohlc("MOONUSD")).toEqual({
			MOONUSD: [[START - 60_000 + shift, "1", "1", "1", "1", "1", "5", 3]],
			last: 0,
		});
		const events: KrakenFeedEvent[] = [];
		source.on((event) => events.push(event));
		source.start();
		await replayClock.advance(1_500);
		expect(events).toEqual([
			{
				type: "ticker",
				wsname: "MOON/USD",
				bid: "1",
				ask: "1.01",
				last: "1",
				volume24h: "1000",
				vwap24h: "1",
				at: START + shift + 1_000,
			},
			{ type: "bar", wsname: "MOON/USD", begin: START + shift, close: "1", volume: "5", at: START + shift + 1_500 },
			{ type: "status", status: "down", dropped: 0, reconnectAt: null },
		]);
		source.stop();
	});
});
