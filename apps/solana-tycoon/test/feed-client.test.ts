import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { RealClock } from "../src/engine/clock";
import { PumpPortalFeed } from "../src/engine/feed/pumpportal";
import type { FeedEvent } from "../src/engine/feed/types";

const MINT = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const createMessage = JSON.stringify({ txType: "create", mint: MINT, name: "Zorp", symbol: "ZORP" });

let server: WebSocketServer;
let url: string;
let dir: string;
let feed: PumpPortalFeed | null = null;
const sockets: WebSocket[] = [];
const received: string[] = [];

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function startFeed(captureFile: string | null = null): { feed: PumpPortalFeed; events: FeedEvent[] } {
	const events: FeedEvent[] = [];
	feed = new PumpPortalFeed({
		url,
		clock: new RealClock(),
		captureFile,
		captureLimit: 50,
		baseDelayMs: 10,
		jitterUnit: () => 0.5,
	});
	feed.on((event) => events.push(event));
	feed.start();
	return { feed, events };
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "feed-"));
	received.length = 0;
	sockets.length = 0;
	server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	server.on("connection", (socket) => {
		sockets.push(socket);
		socket.on("message", (data) => received.push(data.toString()));
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

describe("PumpPortalFeed", () => {
	it("subscribes to new tokens and migrations on open", async () => {
		startFeed();
		await waitFor(() => received.length >= 2);
		expect(received.map((m) => JSON.parse(m))).toEqual([
			{ method: "subscribeNewToken" },
			{ method: "subscribeMigration" },
		]);
		expect(server.clients.size).toBe(1);
	});

	it("emits launches and counts garbage as dropped", async () => {
		const { events } = startFeed();
		await waitFor(() => sockets.length === 1 && received.length >= 2);
		sockets[0].send(createMessage);
		sockets[0].send("garbage{");
		await waitFor(() => events.some((e) => e.type === "status" && e.dropped === 1));
		const launches = events.filter((e) => e.type === "launch");
		expect(launches).toHaveLength(1);
		expect(launches[0].type === "launch" && launches[0].launch.mint).toBe(MINT);
		expect(launches[0].type === "launch" && launches[0].raw).toBe(createMessage);
	});

	it("goes down when the socket closes and comes back live after reconnecting", async () => {
		const { events } = startFeed();
		await waitFor(() => events.some((e) => e.type === "status" && e.status === "live"));
		sockets[0].close();
		await waitFor(() => events.some((e) => e.type === "status" && e.status === "down"));
		const down = events.find((e) => e.type === "status" && e.status === "down");
		expect(down?.type === "status" && down.reconnectAt).not.toBeNull();
		const downIndex = events.indexOf(down as FeedEvent);
		await waitFor(() => events.slice(downIndex).some((e) => e.type === "status" && e.status === "live"));
		expect(sockets).toHaveLength(2);
		expect(server.clients.size).toBe(1);
	});

	it("captures only the first 50 raw messages", async () => {
		const captureFile = join(dir, "fixtures", "raw.jsonl");
		const { events } = startFeed(captureFile);
		await waitFor(() => sockets.length === 1 && received.length >= 2);
		for (let i = 0; i < 60; i++) sockets[0].send(createMessage);
		await waitFor(() => events.filter((e) => e.type === "launch").length === 60);
		expect(existsSync(captureFile)).toBe(true);
		expect(readFileSync(captureFile, "utf8").trimEnd().split("\n")).toHaveLength(50);
	});

	it("stops reconnecting after stop()", async () => {
		const { feed: running, events } = startFeed();
		await waitFor(() => events.some((e) => e.type === "status" && e.status === "live"));
		running.stop();
		await waitFor(() => server.clients.size === 0);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(sockets).toHaveLength(1);
	});
});
