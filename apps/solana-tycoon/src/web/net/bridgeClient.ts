import type { Ack, CommandInput, EngineEvent } from "../../shared/protocol";
import { ServerMessageSchema } from "../../shared/protocol";
import type { ConnectionStatus } from "../state/store";

const RETRY_START_MS = 1_000;
const RETRY_MAX_MS = 10_000;
const ACK_TIMEOUT_MS = 15_000;

interface Pending {
	resolve: (ack: Ack) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

// Reconnects 1s doubling to 10s. Commands sent while offline, or unanswered when the socket drops, reject.
export class BridgeClient {
	private socket: WebSocket | null = null;
	private retryMs = RETRY_START_MS;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	private nextRetryAt: number | null = null;
	private readonly pending = new Map<string, Pending>();
	private readonly eventListeners = new Set<(event: EngineEvent) => void>();
	private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

	constructor(
		private readonly url: string,
		private readonly token: string,
	) {}

	connect(): void {
		this.stopped = false;
		this.nextRetryAt = null;
		this.emitStatus("connecting");
		const socket = new WebSocket(`${this.url}?token=${encodeURIComponent(this.token)}`);
		this.socket = socket;
		socket.onopen = () => {
			this.retryMs = RETRY_START_MS;
			this.emitStatus("open");
		};
		socket.onmessage = (message) => this.onMessage(String(message.data));
		socket.onclose = () => {
			if (this.socket === socket) this.socket = null;
			this.failPending("Connection to the engine was lost");
			this.emitStatus("closed");
			if (this.stopped) return;
			this.nextRetryAt = Date.now() + this.retryMs;
			this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
			this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
		};
	}

	close(): void {
		this.stopped = true;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.socket?.close();
		this.socket = null;
	}

	retryAt(): number | null {
		return this.nextRetryAt;
	}

	onEvent(listener: (event: EngineEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	onStatus(listener: (status: ConnectionStatus) => void): () => void {
		this.statusListeners.add(listener);
		return () => {
			this.statusListeners.delete(listener);
		};
	}

	send(command: CommandInput): Promise<Ack> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Engine offline"));
		const id = crypto.randomUUID();
		return new Promise<Ack>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Engine did not answer"));
			}, ACK_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ ...command, id }));
		});
	}

	private onMessage(text: string): void {
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return;
		}
		const parsed = ServerMessageSchema.safeParse(data);
		if (!parsed.success) return;
		const message = parsed.data;
		if (message.type === "ack") {
			const waiting = this.pending.get(message.id);
			if (!waiting) return;
			clearTimeout(waiting.timer);
			this.pending.delete(message.id);
			waiting.resolve(message);
			return;
		}
		for (const listener of [...this.eventListeners]) listener(message);
	}

	private failPending(reason: string): void {
		for (const [id, waiting] of this.pending) {
			clearTimeout(waiting.timer);
			waiting.reject(new Error(reason));
			this.pending.delete(id);
		}
	}

	private emitStatus(status: ConnectionStatus): void {
		for (const listener of [...this.statusListeners]) listener(status);
	}
}
