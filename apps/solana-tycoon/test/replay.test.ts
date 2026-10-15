import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { web3 } from "../src/engine/chain/solana";
import { ManualClock } from "../src/engine/clock";
import type { FeedEvent } from "../src/engine/feed/types";
import { ReplayDriver } from "../src/engine/replay/player";
import { Recorder } from "../src/engine/replay/recorder";
import { type RecordingLine, readRecording } from "../src/engine/replay/recording";
import { fixtureCurve } from "./helpers/curves";
import { FakeChain } from "./helpers/fakeChain";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "replay-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const MINT = web3.Keypair.generate().publicKey.toBase58();

describe("Recorder and ReplayDriver", () => {
	it("records chain reads and replays them at the recorded times", async () => {
		const file = join(dir, "recordings", "session.jsonl");
		const clock = new ManualClock(50_000);
		const fake = new FakeChain(clock);
		const recorder = new Recorder(file, clock);
		const chain = recorder.wrapChain(fake);

		await chain.fetchGlobals();
		recorder.launchRaw(JSON.stringify({ txType: "create", mint: MINT, name: "Zorp", symbol: "ZORP" }));
		fake.setCurve(MINT, fixtureCurve());
		await clock.advance(1_000);
		const first = await chain.fetchCurve(MINT);
		const updates: string[] = [];
		chain.watchCurve(MINT, (snap) => updates.push(snap.curve.virtualQuoteReserves.toString()));
		await clock.advance(1_500);
		const raised = fixtureCurve();
		raised.virtualQuoteReserves = raised.virtualQuoteReserves.muln(2);
		fake.setCurve(MINT, raised);
		await chain.fetchHolders(MINT, "spl");
		recorder.feedStatus("down");

		const lines = readRecording(file);
		expect(lines.map((line) => [line.kind, line.t])).toEqual([
			["meta", 0],
			["globals", 0],
			["launch", 0],
			["curve", 1_000],
			["curve", 2_500],
			["holders", 2_500],
			["feed", 2_500],
		]);
		expect(updates).toHaveLength(1);

		const replayClock = new ManualClock(0);
		const driver = new ReplayDriver(lines, replayClock, 1);
		const launches: FeedEvent[] = [];
		driver.feed.on((event) => launches.push(event));
		driver.start();
		await replayClock.advance(0);
		expect(launches.filter((event) => event.type === "launch")).toHaveLength(1);
		expect(await driver.chain.fetchCurve(MINT)).toBeNull();
		await replayClock.advance(1_000);
		const replayed = await driver.chain.fetchCurve(MINT);
		expect(replayed?.curve.virtualQuoteReserves.toString()).toBe(first?.curve.virtualQuoteReserves.toString());
		await replayClock.advance(1_500);
		expect((await driver.chain.fetchCurve(MINT))?.curve.virtualQuoteReserves.toString()).toBe(
			raised.virtualQuoteReserves.toString(),
		);
		expect((await driver.chain.fetchHolders(MINT, "spl")).supply).toBe(1_000_000_000_000_000n);
		expect((await driver.chain.fetchGlobals()).global.initialVirtualSolReserves.toString()).toBe("30000000000");
		expect(launches.at(-1)).toMatchObject({ type: "status", status: "down" });
		expect(driver.synthetic).toBe(false);
	});

	it("scales dispatch time by the replay speed", async () => {
		const lines: RecordingLine[] = [
			{ t: 0, kind: "meta", synthetic: true, description: "test", createdAt: "2026-10-15T00:00:00.000Z" },
			{ t: 1_000, kind: "feed", status: "down" },
		];
		const clock = new ManualClock(0);
		const driver = new ReplayDriver(lines, clock, 2);
		const events: FeedEvent[] = [];
		driver.feed.on((event) => events.push(event));
		driver.start();
		await clock.advance(499);
		expect(events).toEqual([]);
		await clock.advance(1);
		expect(events).toEqual([{ type: "status", status: "down", dropped: 0, reconnectAt: null }]);
		expect(driver.synthetic).toBe(true);
	});

	it("tells watchers about curve lines as they dispatch", async () => {
		const clock = new ManualClock(0);
		const fake = new FakeChain(clock);
		const recorder = new Recorder(join(dir, "r.jsonl"), clock);
		const chain = recorder.wrapChain(fake);
		fake.setCurve(MINT, fixtureCurve());
		await chain.fetchCurve(MINT);
		await clock.advance(2_000);
		await chain.fetchCurve(MINT);

		const replayClock = new ManualClock(10_000);
		const driver = new ReplayDriver(readRecording(join(dir, "r.jsonl")), replayClock, 1);
		const seen: number[] = [];
		driver.chain.watchCurve(MINT, (snap) => seen.push(snap.at));
		driver.start();
		await replayClock.advance(2_000);
		expect(seen).toEqual([10_000, 12_000]);
	});
});
