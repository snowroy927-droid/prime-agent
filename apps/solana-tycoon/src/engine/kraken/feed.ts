import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import WebSocket from "ws";
import type { FeedStatus } from "../../shared/types";
import type { Clock } from "../clock";
import { backoffDelay } from "../feed/backoff";
import { decimalText } from "./money";

export type KrakenFeedEvent =
	| {
			type: "ticker";
			wsname: string;
			bid: string;
			ask: string;
			last: string;
			volume24h: string;
			vwap24h: string | null;
			at: number;
	  }
	| { type: "bar"; wsname: string; begin: number; close: string; volume: string; at: number }
	| { type: "status"; status: FeedStatus; dropped: number; reconnectAt: number | null };

export interface KrakenFeedLike {
	setSymbols(wsnames: readonly string[]): void;
	start(): void;
	stop(): void;
	on(listener: (event: KrakenFeedEvent) => void): () => void;
	onRaw?(listener: (raw: string) => void): () => void;
}

export interface KrakenFeedOptions {
	url: string;
	clock: Clock;
	captureFile: string | null;
	captureLimit: number;
	baseDelayMs?: number;
	jitterUnit?: () => number;
}

type Parsed = { kind: "events"; events: KrakenFeedEvent[] } | { kind: "ignored" } | { kind: "invalid" };

const BATCH = 50;
const IGNORED_CHANNELS = new Set(["heartbeat", "status", "pong"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const decimal = (value: unknown): string | null =>
	typeof value === "number" || typeof value === "string" ? decimalText(value) : null;

function epochMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return null;
	// Kraken may send nanosecond fractions; Date.parse needs at most milliseconds.
	const ms = Date.parse(value.replace(/\.(\d{3})\d+/, ".$1"));
	return Number.isNaN(ms) ? null : ms;
}

function tickerEvent(item: Record<string, unknown>, at: number): KrakenFeedEvent | null {
	const bid = decimal(item.bid);
	const ask = decimal(item.ask);
	const last = decimal(item.last);
	if (typeof item.symbol !== "string" || bid === null || ask === null || last === null) return null;
	return {
		type: "ticker",
		wsname: item.symbol,
		bid,
		ask,
		last,
		volume24h: decimal(item.volume) ?? "0",
		vwap24h: decimal(item.vwap),
		at,
	};
}

function barEvent(item: Record<string, unknown>, at: number): KrakenFeedEvent | null {
	const close = decimal(item.close);
	const volume = decimal(item.volume);
	const begin = epochMs(item.interval_begin);
	if (typeof item.symbol !== "string" || close === null || volume === null || begin === null) return null;
	if (item.interval !== undefined && item.interval !== 1) return null;
	return { type: "bar", wsname: item.symbol, begin, close, volume, at };
}

// Field names follow Kraken's WebSocket v2 docs; they are unverified against live traffic (spec Section 2),
// so anything unreadable is reported as invalid and counted rather than guessed at.
export function parseKrakenMessage(raw: string, now: number): Parsed {
	let message: unknown;
	try {
		message = JSON.parse(raw);
	} catch {
		return { kind: "invalid" };
	}
	if (!isRecord(message)) return { kind: "invalid" };
	if ("method" in message) return { kind: "ignored" };
	const channel = message.channel;
	if (typeof channel === "string" && IGNORED_CHANNELS.has(channel)) return { kind: "ignored" };
	const toEvent = channel === "ticker" ? tickerEvent : channel === "ohlc" ? barEvent : null;
	if (!toEvent || !Array.isArray(message.data)) return { kind: "invalid" };
	const events: KrakenFeedEvent[] = [];
	for (const item of message.data) {
		if (!isRecord(item)) continue;
		try {
			const event = toEvent(item, now);
			if (event) events.push(event);
		} catch {
			// decimalText rejected a value; the item is skipped.
		}
	}
	return events.length > 0 ? { kind: "events", events } : { kind: "invalid" };
}

function cryptoUnit(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

function batches(symbols: readonly string[]): string[][] {
	const out: string[][] = [];
	for (let i = 0; i < symbols.length; i += BATCH) out.push(symbols.slice(i, i + BATCH));
	return out;
}

export class KrakenFeed implements KrakenFeedLike {
	private readonly listeners = new Set<(event: KrakenFeedEvent) => void>();
	private readonly rawListeners = new Set<(raw: string) => void>();
	private symbols: string[] = [];
	private running = false;
	private socket: WebSocket | null = null;
	private open = false;
	private dropped = 0;
	private captured = 0;

	constructor(private readonly opts: KrakenFeedOptions) {}

	setSymbols(wsnames: readonly string[]): void {
		const next = [...new Set(wsnames)];
		const added = next.filter((symbol) => !this.symbols.includes(symbol));
		const removed = this.symbols.filter((symbol) => !next.includes(symbol));
		this.symbols = next;
		if (!this.open) return;
		this.send("unsubscribe", removed);
		this.send("subscribe", added);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		void this.loop();
	}

	stop(): void {
		this.running = false;
		this.socket?.close();
		this.socket = null;
	}

	on(listener: (event: KrakenFeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onRaw(listener: (raw: string) => void): () => void {
		this.rawListeners.add(listener);
		return () => {
			this.rawListeners.delete(listener);
		};
	}

	private async loop(): Promise<void> {
		const jitter = this.opts.jitterUnit ?? cryptoUnit;
		let attempt = 0;
		while (this.running) {
			this.emitStatus("connecting", null);
			const opened = await this.connectOnce();
			if (!this.running) break;
			if (opened) attempt = 0;
			const delay = backoffDelay(attempt, jitter(), this.opts.baseDelayMs);
			attempt += 1;
			this.emitStatus("down", this.opts.clock.now() + delay);
			await this.opts.clock.sleep(delay);
		}
	}

	private connectOnce(): Promise<boolean> {
		return new Promise((resolve) => {
			let opened = false;
			const socket = new WebSocket(this.opts.url);
			this.socket = socket;
			socket.on("open", () => {
				opened = true;
				this.open = true;
				this.send("subscribe", this.symbols);
				this.emitStatus("live", null);
			});
			socket.on("message", (data) => this.handle(data.toString()));
			socket.on("error", () => {
				// A close event always follows; the loop handles the reconnect.
			});
			socket.on("close", () => {
				if (this.socket === socket) {
					this.socket = null;
					this.open = false;
				}
				resolve(opened);
			});
		});
	}

	private send(method: "subscribe" | "unsubscribe", symbols: readonly string[]): void {
		const socket = this.socket;
		if (!socket || symbols.length === 0) return;
		for (const channel of ["ticker", "ohlc"] as const) {
			for (const symbol of batches(symbols)) {
				const params = channel === "ohlc" ? { channel, symbol, interval: 1 } : { channel, symbol };
				socket.send(JSON.stringify({ method, params }));
			}
		}
	}

	private handle(raw: string): void {
		this.capture(raw);
		for (const listener of [...this.rawListeners]) listener(raw);
		const parsed = parseKrakenMessage(raw, this.opts.clock.now());
		if (parsed.kind === "events") {
			for (const event of parsed.events) this.emit(event);
		} else if (parsed.kind === "invalid") {
			this.dropped += 1;
			this.emitStatus("live", null);
		}
	}

	private capture(raw: string): void {
		const file = this.opts.captureFile;
		if (file === null || this.captured >= this.opts.captureLimit) return;
		if (this.captured === 0) mkdirSync(dirname(file), { recursive: true });
		this.captured += 1;
		appendFileSync(file, `${raw.replace(/\n/g, " ")}\n`);
	}

	private emitStatus(status: FeedStatus, reconnectAt: number | null): void {
		this.emit({ type: "status", status, dropped: this.dropped, reconnectAt });
	}

	private emit(event: KrakenFeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
