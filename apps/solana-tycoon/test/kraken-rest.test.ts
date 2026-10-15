import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/engine/clock";
import { type HttpGet, KrakenRest, KrakenRestError, makeFetchGet } from "../src/engine/kraken/rest";

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
		const body = JSON.stringify({ error: ["EQuery:Unknown asset pair"], result: {} });
		const { get, calls } = fakeGet(clock, [{ status: 200, body }]);
		const rest = new KrakenRest({ get, clock });
		await expect(settle(clock, rest.assetPairs())).rejects.toThrow("EQuery:Unknown asset pair");
		expect(calls).toHaveLength(1);
	});

	it("retries network errors, 5xx, and rate limits reported inside the body", async () => {
		const clock = new ManualClock(0);
		const limited = { status: 200, body: JSON.stringify({ error: ["EAPI:Rate limit exceeded"], result: {} }) };
		const calls: number[] = [];
		const answers: (() => { status: number; body: string })[] = [
			() => {
				throw new TypeError("fetch failed");
			},
			() => ({ status: 503, body: "" }),
			() => limited,
			() => ok({ fine: true }),
		];
		const get: HttpGet = async () => {
			calls.push(clock.now());
			const next = answers.shift();
			if (!next) throw new Error("no more responses");
			return next();
		};
		const rest = new KrakenRest({ get, clock, jitterUnit: () => 0.5 });
		expect(await settle(clock, rest.assetPairs())).toEqual({ fine: true });
		expect(calls).toHaveLength(4);
		for (let i = 1; i < calls.length; i++) expect(calls[i] - calls[i - 1]).toBeGreaterThanOrEqual(1_000);
	});

	it("gives up with the last error after four failed attempts", async () => {
		const clock = new ManualClock(0);
		const get: HttpGet = async () => {
			throw new TypeError("fetch failed");
		};
		const rest = new KrakenRest({ get, clock, jitterUnit: () => 0.5 });
		await expect(settle(clock, rest.assetPairs())).rejects.toThrow("fetch failed");
	});

	it("refuses a ticker batch over 100 pairs", async () => {
		const clock = new ManualClock(0);
		const rest = new KrakenRest({ get: fakeGet(clock, []).get, clock });
		await expect(rest.ticker(Array.from({ length: 101 }, (_, i) => `P${i}USD`))).rejects.toThrow("100");
	});
});

describe("fetchGet", () => {
	it("gives up on a server that accepts the connection and never answers", async () => {
		const server: Server = createServer(() => undefined);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("no port");
		try {
			const started = Date.now();
			await expect(makeFetchGet(200)(`http://127.0.0.1:${address.port}/`)).rejects.toThrow();
			expect(Date.now() - started).toBeLessThan(5_000);
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});
});
