import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { CommandSchema, PROTOCOL_VERSION, type ServerMessage } from "../../shared/protocol";
import type { Mode } from "../../shared/types";
import type { EngineBus } from "../bus";
import type { TradingCore } from "../core/tradingCore";

export interface BridgeOptions {
	port: number;
	staticDir: string;
	core: Pick<TradingCore, "snapshot" | "handleCommand">;
	bus: EngineBus;
	token: string;
	mode: Mode;
	synthetic: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".map": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
};

const MAX_COMMAND_BYTES = 64 * 1024;
// A client this far behind is not reading; drop it rather than buffer without limit.
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export function createSessionToken(): string {
	return randomBytes(24).toString("base64url");
}

function tokensMatch(given: string | null, expected: string): boolean {
	if (given === null) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

function refuseUpgrade(socket: Duplex, status: 401 | 403 | 404 | 421, text: string): void {
	socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
	socket.destroy();
}

export class BridgeServer {
	private readonly server: Server;
	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_COMMAND_BYTES });
	private readonly clients = new Set<WebSocket>();
	private offBus: (() => void) | null = null;
	private port = 0;

	constructor(private readonly opts: BridgeOptions) {
		this.server = createServer((req, res) => this.onRequest(req, res));
		this.server.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
	}

	listen(): Promise<{ url: string; port: number }> {
		return new Promise((resolveListen, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.opts.port, "127.0.0.1", () => {
				const address = this.server.address();
				this.port = typeof address === "object" && address ? address.port : this.opts.port;
				this.offBus = this.opts.bus.on((event) => this.broadcast(event));
				resolveListen({ url: `http://127.0.0.1:${this.port}`, port: this.port });
			});
		});
	}

	close(): Promise<void> {
		this.offBus?.();
		this.offBus = null;
		for (const client of this.clients) client.terminate();
		this.clients.clear();
		this.wss.close();
		return new Promise((resolveClose) => {
			this.server.closeAllConnections();
			this.server.close(() => resolveClose());
		});
	}

	private allowedHosts(): string[] {
		return [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
	}

	private onRequest(req: IncomingMessage, res: ServerResponse): void {
		if (!this.allowedHosts().includes(req.headers.host ?? "")) {
			res.writeHead(421, { "Content-Type": "text/plain" }).end("Misdirected request");
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { Allow: "GET, HEAD" }).end();
			return;
		}
		const root = resolve(this.opts.staticDir);
		if (!existsSync(root)) {
			res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end(
				"Web app not built. Run npm run build:web.",
			);
			return;
		}
		let pathname: string;
		try {
			pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
		} catch {
			res.writeHead(400).end();
			return;
		}
		const headers = {
			"Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:${this.port} ws://localhost:${this.port}; frame-ancestors 'none'`,
			"X-Frame-Options": "DENY",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		};
		if (pathname === "/" || pathname === "/index.html") {
			const index = resolve(root, "index.html");
			if (!existsSync(index)) {
				res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end(
					"Web app not built. Run npm run build:web.",
				);
				return;
			}
			const html = readFileSync(index, "utf8").replaceAll("%SNIPER_TOKEN%", this.opts.token);
			res.writeHead(200, { ...headers, "Content-Type": CONTENT_TYPES[".html"], "Cache-Control": "no-store" }).end(
				html,
			);
			return;
		}
		const file = resolve(root, `.${pathname}`);
		if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
			res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
			return;
		}
		res.writeHead(200, {
			...headers,
			"Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
		}).end(readFileSync(file));
	}

	private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
		const refusal = this.upgradeRefusal(req);
		if (refusal) {
			refuseUpgrade(socket, refusal[0], refusal[1]);
			return;
		}
		this.wss.handleUpgrade(req, socket, head, (ws) => this.onClient(ws));
	}

	private upgradeRefusal(req: IncomingMessage): [401 | 403 | 404 | 421, string] | null {
		if (!this.allowedHosts().includes(req.headers.host ?? "")) return [421, "Misdirected Request"];
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname !== "/ws") return [404, "Not Found"];
		if (!tokensMatch(url.searchParams.get("token"), this.opts.token)) return [401, "Unauthorized"];
		const origin = req.headers.origin ?? "";
		if (!this.allowedHosts().some((host) => origin === `http://${host}`)) return [403, "Forbidden"];
		return null;
	}

	private onClient(ws: WebSocket): void {
		this.clients.add(ws);
		ws.on("close", () => this.clients.delete(ws));
		ws.on("error", () => this.clients.delete(ws));
		ws.on("message", (data) => void this.onMessage(ws, data.toString()));
		this.send(ws, {
			type: "hello",
			protocolVersion: PROTOCOL_VERSION,
			mode: this.opts.mode,
			synthetic: this.opts.synthetic,
		});
		this.send(ws, { type: "snapshot", snapshot: this.opts.core.snapshot() });
	}

	private async onMessage(ws: WebSocket, raw: string): Promise<void> {
		let data: unknown;
		try {
			data = JSON.parse(raw);
		} catch {
			data = null;
		}
		const parsed = CommandSchema.safeParse(data);
		if (!parsed.success) {
			const id =
				typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string"
					? (data as { id: string }).id
					: "unknown";
			this.send(ws, { type: "ack", id, ok: false, error: "Invalid command" });
			return;
		}
		const ack = await this.opts.core.handleCommand(parsed.data);
		this.send(ws, ack);
	}

	private broadcast(message: ServerMessage): void {
		const text = JSON.stringify(message);
		for (const client of this.clients) this.sendText(client, text);
	}

	private send(ws: WebSocket, message: ServerMessage): void {
		this.sendText(ws, JSON.stringify(message));
	}

	private sendText(ws: WebSocket, text: string): void {
		if (ws.readyState !== ws.OPEN) return;
		if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
			ws.terminate();
			this.clients.delete(ws);
			return;
		}
		ws.send(text);
	}
}
