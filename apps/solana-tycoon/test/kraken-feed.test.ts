import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { RealClock } from "../src/engine/clock";
import { KrakenFeed, type KrakenFeedEvent, parseKrakenMessage } from "../src/engine/kraken/feed";

let server: WebSocketServer;
let url: string;
let dir: string;
let feed: KrakenFeed | null = null;
const sockets: WebSocket[] = [];
const received: { channel: string; method: string; symbols: string[]; interval?: number }[] = [];

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function startFeed(captureFile: string | null = null): { feed: KrakenFeed; events: KrakenFeedEvent[] } {
	const events: KrakenFeedEvent[] = [];
	feed = new KrakenFeed({
		url,
		clock: new RealClock(),
		captureFile,
		captureLimit: 2,
		baseDelayMs: 10,
		jitterUnit: () => 0.5,
	});
	feed.on((event) => events.push(event));
	return { feed, events };
}

const TICKER = JSON.stringify({
	channel: "ticker",
	type: "update",
	data: [{ symbol: "PEPE/USD", bid: 1.234e-8, ask: 1.3e-8, last: 1.25e-8, volume: 123456789, vwap: 1.24e-8 }],
});
const OHLC = JSON.stringify({
	channel: "ohlc",
	type: "update",
	data: [
		{
			symbol: "PEPE/USD",
			close: "0.0000000125",
			volume: 5000,
			interval_begin: "2026-10-15T12:00:00.000000000Z",
			interval: 1,
		},
	],
});

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kfeed-"));
	received.length = 0;
	sockets.length = 0;
	server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	server.on("connection", (socket) => {
		sockets.push(socket);
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as {
				method: string;
				params: { channel: string; symbol: string[]; interval?: number };
			};
			received.push({
				method: message.method,
				channel: message.params.channel,
				symbols: message.params.symbol,
				interval: message.params.interval,
			});
		});
	});
	await new Promise<void>((resolve) => server.on("listening", () => resolve()));
	url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
	feed?.stop();
	feed = null;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	rmSync(dir, { recursive: true, force: true });
});

describe("parseKrakenMessage", () => {
	it("reads ticker data with exponent-formatted numbers as exact decimals", () => {
		expect(parseKrakenMessage(TICKER, 5)).toEqual({
			kind: "events",
			events: [
				{
					type: "ticker",
					wsname: "PEPE/USD",
					bid: "0.00000001234",
					ask: "0.000000013",
					last: "0.0000000125",
					volume24h: "123456789",
					vwap24h: "0.0000000124",
					at: 5,
				},
			],
		});
	});

	it("reads one-minute candles with their start time in epoch ms", () => {
		expect(parseKrakenMessage(OHLC, 5)).toEqual({
			kind: "events",
			events: [
				{
					type: "bar",
					wsname: "PEPE/USD",
					begin: Date.UTC(2026, 9, 15, 12, 0),
					close: "0.0000000125",
					volume: "5000",
					at: 5,
				},
			],
		});
	});

	it("reports a symbol Kraken refuses to subscribe", () => {
		const reply = {
			method: "subscribe",
			success: false,
			error: "Currency pair not supported XBT/USD",
			symbol: "XBT/USD",
		};
		expect(parseKrakenMessage(JSON.stringify(reply), 0)).toEqual({
			kind: "events",
			events: [{ type: "rejected", symbol: "XBT/USD", error: "Currency pair not supported XBT/USD" }],
		});
		expect(parseKrakenMessage(JSON.stringify({ method: "subscribe", success: false }), 0)).toEqual({
			kind: "events",
			events: [{ type: "rejected", symbol: null, error: "subscribe failed" }],
		});
	});

	it("ignores heartbeats, status and acks, and flags anything else", () => {
		expect(parseKrakenMessage(JSON.stringify({ channel: "heartbeat" }), 0)).toEqual({ kind: "ignored" });
		expect(parseKrakenMessage(JSON.stringify({ channel: "status", data: [] }), 0)).toEqual({ kind: "ignored" });
		expect(parseKrakenMessage(JSON.stringify({ method: "subscribe", success: true }), 0)).toEqual({
			kind: "ignored",
		});
		expect(parseKrakenMessage("not json", 0)).toEqual({ kind: "invalid" });
		expect(parseKrakenMessage(JSON.stringify({ channel: "ticker", data: [{ symbol: "X/USD" }] }), 0)).toEqual({
			kind: "invalid",
		});
	});
});

describe("KrakenFeed", () => {
	it("subscribes ticker and one-minute ohlc in batches of 50 symbols", async () => {
		const { feed } = startFeed();
		feed.setSymbols(Array.from({ length: 120 }, (_, i) => `C${i}/USD`));
		feed.start();
		await waitFor(() => received.length >= 6);
		const ticker = received.filter((m) => m.channel === "ticker");
		const ohlc = received.filter((m) => m.channel === "ohlc");
		expect(ticker.map((m) => m.symbols.length)).toEqual([50, 50, 20]);
		expect(ohlc.map((m) => m.symbols.length)).toEqual([50, 50, 20]);
		expect(ohlc.every((m) => m.interval === 1 && m.method === "subscribe")).toBe(true);
	});

	it("unsubscribes symbols that leave the set", async () => {
		const { feed } = startFeed();
		feed.setSymbols(["A/USD", "B/USD"]);
		feed.start();
		await waitFor(() => received.length >= 2);
		feed.setSymbols(["A/USD"]);
		await waitFor(() => received.some((m) => m.method === "unsubscribe" && m.channel === "ohlc"));
		const unsubscribed = received.filter((m) => m.method === "unsubscribe");
		expect(unsubscribed.map((m) => [m.channel, m.symbols])).toEqual([
			["ticker", ["B/USD"]],
			["ohlc", ["B/USD"]],
		]);
	});

	it("emits parsed events, counts dropped messages, and captures raw samples", async () => {
		const capture = join(dir, "fixtures", "kraken-raw.jsonl");
		const { feed, events } = startFeed(capture);
		feed.setSymbols(["PEPE/USD"]);
		feed.start();
		await waitFor(() => sockets.length === 1 && received.length >= 2);
		sockets[0].send(TICKER);
		sockets[0].send("garbage");
		sockets[0].send(OHLC);
		await waitFor(() => events.some((event) => event.type === "bar"));
		expect(events.find((event) => event.type === "ticker")).toMatchObject({ bid: "0.00000001234" });
		expect(events.some((event) => event.type === "status" && event.dropped === 1)).toBe(true);
		expect(existsSync(capture)).toBe(true);
		expect(readFileSync(capture, "utf8").trim().split("\n")).toHaveLength(2);
	});

	it("reconnects after the server drops it and resubscribes every symbol", async () => {
		const { feed, events } = startFeed();
		feed.setSymbols(["PEPE/USD", "WIF/USD"]);
		feed.start();
		await waitFor(() => sockets.length === 1 && received.length >= 2);
		sockets[0].terminate();
		await waitFor(() => sockets.length === 2 && received.length >= 4);
		expect(received.slice(2).map((m) => [m.channel, m.symbols])).toEqual([
			["ticker", ["PEPE/USD", "WIF/USD"]],
			["ohlc", ["PEPE/USD", "WIF/USD"]],
		]);
		expect(
			events.some((event) => event.type === "status" && event.status === "down" && event.reconnectAt !== null),
		).toBe(true);
	});
});
