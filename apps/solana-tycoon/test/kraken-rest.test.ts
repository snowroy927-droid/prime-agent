import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { type HttpGet, KrakenRest, KrakenRestError } from "../src/engine/kraken/rest";

function fakeGet(clock: ManualClock, responses: { status: number; body: string }[]) {
	const calls: { url: string; at: number }[] = [];
	const get: HttpGet = async (url) => {
		calls.push({ url, at: clock.now() });
		const next = responses.shift();
		if (!next) throw new Error("no more responses");
		return next;
	};
	return { get, calls };
}

const ok = (result: unknown) => ({ status: 200, body: JSON.stringify({ error: [], result }) });

async function settle<T>(clock: ManualClock, promise: Promise<T>): Promise<T> {
	let done = false;
	const tracked = promise.finally(() => {
		done = true;
	});
	// Rejections are asserted by the caller; mark them handled so they are not reported early.
	tracked.catch(() => undefined);
	for (let i = 0; i < 100 && !done; i++) await clock.advance(250);
	return tracked;
}

describe("KrakenRest", () => {
	it("spaces requests at least one second apart", async () => {
		const clock = new ManualClock(0);
		const { get, calls } = fakeGet(clock, [ok({ a: 1 }), ok({ b: 2 })]);
		const rest = new KrakenRest({ get, clock, jitterUnit: () => 0.5 });
		const first = rest.assetPairs();
		const second = rest.ohlc("PEPEUSD");
		expect(await settle(clock, first)).toEqual({ a: 1 });
		expect(await settle(clock, second)).toEqual({ b: 2 });
		expect(calls.map((call) => call.at)).toEqual([0, 1_000]);
		expect(calls[0].url).toBe("https://api.kraken.com/0/public/AssetPairs");
		expect(calls[1].url).toBe("https://api.kraken.com/0/public/OHLC?pair=PEPEUSD&interval=1");
	});

	it("backs off and retries after HTTP 429", async () => {
		const clock = new ManualClock(0);
		const { get, calls } = fakeGet(clock, [{ status: 429, body: "" }, ok({ ok: true })]);
		const rest = new KrakenRest({ get, clock, jitterUnit: () => 0.5 });
		expect(await settle(clock, rest.ticker(["PEPEUSD", "WIFUSD"]))).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
		expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1_000);
		expect(calls[0].url).toBe("https://api.kraken.com/0/public/Ticker?pair=PEPEUSD,WIFUSD");
	});

	it("gives up after four rate-limited attempts", async () => {
		const clock = new ManualClock(0);
		const limited = { status: 429, body: "" };
		const { get, calls } = fakeGet(clock, [limited, limited, limited, limited]);
		const rest = new KrakenRest({ get, clock, jitterUnit: () => 0.5 });
		await expect(settle(clock, rest.assetPairs())).rejects.toBeInstanceOf(KrakenRestError);
		expect(calls).toHaveLength(4);
	});

	it("turns Kraken's error envelope into an error with its text", async () => {
		const clock = new ManualClock(0);
		const body = JSON.stringify({ error: ["EGeneral:Too many requests"], result: {} });
		const { get } = fakeGet(clock, [{ status: 200, body }]);
		const rest = new KrakenRest({ get, clock });
		await expect(settle(clock, rest.assetPairs())).rejects.toThrow("EGeneral:Too many requests");
	});

	it("refuses a ticker batch over 100 pairs", async () => {
		const clock = new ManualClock(0);
		const rest = new KrakenRest({ get: fakeGet(clock, []).get, clock });
		await expect(rest.ticker(Array.from({ length: 101 }, (_, i) => `P${i}USD`))).rejects.toThrow("100");
	});
});
