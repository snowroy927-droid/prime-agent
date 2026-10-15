import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BridgeServer, createSessionToken } from "../src/engine/bridge/server";
import { EngineBus } from "../src/engine/bus";
import type { Ack, Command, EngineSnapshot, ServerMessage } from "../src/shared/protocol";

let dir: string;
let staticDir: string;
let bridge: BridgeServer | null = null;
let port = 0;
const token = createSessionToken();
const bus = new EngineBus();
const commands: Command[] = [];
const sockets: WebSocket[] = [];

const fakeSnapshot = { serverTime: 1 } as unknown as EngineSnapshot;
const core = {
	snapshot: () => fakeSnapshot,
	handleCommand: async (command: Command): Promise<Ack> => {
		commands.push(command);
		return { type: "ack", id: command.id, ok: true };
	},
};

async function start(dirOverride?: string): Promise<void> {
	bridge = new BridgeServer({
		port: 0,
		staticDir: dirOverride ?? staticDir,
		core,
		bus,
		token,
		mode: "paper",
		synthetic: false,
	});
	({ port } = await bridge.listen());
}

function get(
	path: string,
	host = `127.0.0.1:${port}`,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port, path, headers: { Host: host } }, (res) => {
			let body = "";
			res.on("data", (chunk) => {
				body += chunk;
			});
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

function connect(
	query: string,
	origin = `http://127.0.0.1:${port}`,
): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers: { Origin: origin } });
		sockets.push(ws);
		const messages: ServerMessage[] = [];
		ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
		ws.on("open", () => resolve({ ws, messages }));
		ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
		ws.on("error", reject);
	});
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > 3_000) throw new Error("timed out");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "bridge-"));
	staticDir = join(dir, "web");
	mkdirSync(join(staticDir, "assets"), { recursive: true });
	writeFileSync(
		join(staticDir, "index.html"),
		'<meta name="sniper-token" content="%SNIPER_TOKEN%"><div id="app"></div>',
	);
	writeFileSync(join(staticDir, "assets", "app.js"), "console.log('hi')");
	writeFileSync(join(dir, "package.json"), '{"secret":true}');
	commands.length = 0;
	await start();
});

afterEach(async () => {
	for (const ws of sockets.splice(0)) ws.terminate();
	await bridge?.close();
	bridge = null;
	rmSync(dir, { recursive: true, force: true });
});

describe("BridgeServer HTTP", () => {
	it("rejects a foreign Host header", async () => {
		expect((await get("/", "evil.example")).status).toBe(421);
		expect((await get("/", `localhost:${port}`)).status).toBe(200);
	});

	it("injects the session token and sends a strict CSP", async () => {
		const res = await get("/");
		expect(res.status).toBe(200);
		expect(res.body).toContain(`content="${token}"`);
		expect(res.body).not.toContain("%SNIPER_TOKEN%");
		expect(res.headers["content-security-policy"]).toBe(
			`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; frame-ancestors 'none'`,
		);
		expect(res.headers["x-frame-options"]).toBe("DENY");
	});

	it("serves static assets and refuses paths outside the web root", async () => {
		const asset = await get("/assets/app.js");
		expect(asset.status).toBe(200);
		expect(asset.headers["content-type"]).toContain("javascript");
		expect((await get("/..%2fpackage.json")).status).toBe(404);
		expect((await get("/assets/..%2f..%2fpackage.json")).status).toBe(404);
		expect((await get("/missing.js")).status).toBe(404);
	});

	it("explains a missing web build with 503", async () => {
		await bridge?.close();
		await start(join(dir, "not-built"));
		const res = await get("/");
		expect(res.status).toBe(503);
		expect(res.body).toBe("Web app not built. Run npm run build:web.");
	});
});

describe("BridgeServer WebSocket", () => {
	it("refuses a connection without the token", async () => {
		await expect(connect("")).rejects.toThrow("HTTP 401");
		await expect(connect("?token=wrong")).rejects.toThrow("HTTP 401");
	});

	it("refuses a foreign Origin even with the token", async () => {
		await expect(connect(`?token=${token}`, "http://evil.example")).rejects.toThrow("HTTP 403");
	});

	it("greets a client with hello then a snapshot", async () => {
		const { messages } = await connect(`?token=${token}`);
		await waitFor(() => messages.length >= 2);
		expect(messages[0]).toEqual({ type: "hello", protocolVersion: 1, mode: "paper", synthetic: false });
		expect(messages[1]).toEqual({ type: "snapshot", snapshot: fakeSnapshot });
	});

	it("acks valid commands to the sender and rejects invalid ones", async () => {
		const { ws, messages } = await connect(`?token=${token}`);
		await waitFor(() => messages.length >= 2);
		ws.send(JSON.stringify({ type: "pause", id: "c1" }));
		ws.send("{not json");
		ws.send(JSON.stringify({ type: "sell", id: "c2", mint: "x", pct: 30 }));
		await waitFor(() => messages.filter((m) => m.type === "ack").length >= 3);
		const acks = messages.filter((m): m is Ack => m.type === "ack");
		expect(acks).toEqual(
			expect.arrayContaining([
				{ type: "ack", id: "c1", ok: true },
				{ type: "ack", id: "unknown", ok: false, error: "Invalid command" },
				{ type: "ack", id: "c2", ok: false, error: "Invalid command" },
			]),
		);
		expect(commands).toEqual([{ type: "pause", id: "c1" }]);
	});

	it("broadcasts bus events to every client and acks only the sender", async () => {
		const a = await connect(`?token=${token}`);
		const b = await connect(`?token=${token}`);
		await waitFor(() => a.messages.length >= 2 && b.messages.length >= 2);
		bus.emit({ type: "balance", lamports: "42" });
		a.ws.send(JSON.stringify({ type: "resume", id: "only-a" }));
		await waitFor(() => a.messages.some((m) => m.type === "ack"));
		await waitFor(() => b.messages.some((m) => m.type === "balance"));
		expect(a.messages).toContainEqual({ type: "balance", lamports: "42" });
		expect(b.messages).toContainEqual({ type: "balance", lamports: "42" });
		expect(b.messages.some((m) => m.type === "ack")).toBe(false);
	});
});
