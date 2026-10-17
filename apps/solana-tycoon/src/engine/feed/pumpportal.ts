import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import WebSocket from "ws";
import type { FeedStatus } from "../../shared/types";
import type { Clock } from "../clock";
import { backoffDelay } from "./backoff";
import { parsePumpPortalMessage } from "./parse";
import type { FeedEvent, LaunchFeed } from "./types";

export interface PumpPortalFeedOptions {
	url: string;
	clock: Clock;
	captureFile: string | null;
	captureLimit: number;
	baseDelayMs?: number;
	jitterUnit?: () => number;
}

const SUBSCRIBE_MESSAGES = [{ method: "subscribeNewToken" }, { method: "subscribeMigration" }];

function cryptoUnit(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

export class PumpPortalFeed implements LaunchFeed {
	private readonly listeners = new Set<(event: FeedEvent) => void>();
	private running = false;
	private socket: WebSocket | null = null;
	private dropped = 0;
	private captured = 0;

	constructor(private readonly opts: PumpPortalFeedOptions) {}

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

	on(listener: (event: FeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
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

	// Resolves when the socket closes, with whether it ever opened.
	private connectOnce(): Promise<boolean> {
		return new Promise((resolve) => {
			let opened = false;
			const socket = new WebSocket(this.opts.url);
			this.socket = socket;
			socket.on("open", () => {
				opened = true;
				for (const message of SUBSCRIBE_MESSAGES) socket.send(JSON.stringify(message));
				this.emitStatus("live", null);
			});
			socket.on("message", (data) => this.handle(data.toString()));
			socket.on("error", () => {
				// A close event always follows; the loop handles the reconnect.
			});
			socket.on("close", () => {
				if (this.socket === socket) this.socket = null;
				resolve(opened);
			});
		});
	}

	private handle(raw: string): void {
		this.capture(raw);
		const parsed = parsePumpPortalMessage(raw, this.opts.clock.now());
		if (parsed.kind === "launch") this.emit({ type: "launch", launch: parsed.launch, raw });
		else if (parsed.kind === "migration") this.emit({ type: "migration", mint: parsed.mint });
		else if (parsed.kind === "invalid") {
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

	private emit(event: FeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
