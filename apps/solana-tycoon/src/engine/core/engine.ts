import type { Ack, Command, EngineSnapshot, PumpCommand } from "../../shared/protocol";
import type { EngineBus } from "../bus";
import type { Clock } from "../clock";
import type { KrakenDesk } from "../kraken/desk";
import type { TradingCore } from "./tradingCore";

type PumpDesk = Pick<TradingCore, "start" | "stop" | "snapshot" | "handleCommand">;
type KrakenDeskLike = Pick<KrakenDesk, "start" | "stop" | "snapshot" | "handleCommand" | "kill" | "resume">;
type KrakenCommandIn = Exclude<Command, PumpCommand>;
type Result = { ok: true } | { ok: false; error: string };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isKraken = (command: Command): command is KrakenCommandIn => command.type.startsWith("kraken_");

// One snapshot and one command stream over the pump.fun desk and, when on, the Kraken desk. KILL acts on both
// desks; after a kill, RESUME from either desk lifts it on both. Outside a kill, pause and resume stay per desk.
export class Engine {
	private krakenError: string | null = null;
	private killed = false;

	constructor(
		private readonly pump: PumpDesk,
		private readonly kraken: KrakenDeskLike | null,
		private readonly deps: { bus: EngineBus; clock: Clock },
	) {}

	async start(): Promise<void> {
		await this.pump.start();
		if (!this.kraken) return;
		try {
			await this.kraken.start();
		} catch (error) {
			const text = message(error);
			this.krakenError = text;
			this.deps.bus.emit({ type: "kraken_offline", error: text });
			this.deps.bus.emit({
				type: "log",
				line: { level: "error", message: `Kraken: desk offline (${text})`, at: this.deps.clock.now() },
			});
		}
	}

	async stop(): Promise<void> {
		await Promise.all([this.pump.stop(), this.kraken?.stop()]);
	}

	snapshot(): EngineSnapshot {
		return {
			...this.pump.snapshot(),
			kraken: this.kraken ? { ...this.kraken.snapshot(), error: this.krakenError } : null,
		};
	}

	async handleCommand(command: Command): Promise<Ack> {
		const ack = (result: Result): Ack =>
			result.ok
				? { type: "ack", id: command.id, ok: true }
				: { type: "ack", id: command.id, ok: false, error: result.error };
		const krakenLive = this.kraken !== null && this.krakenError === null;
		if (command.type === "kill") {
			this.killed = true;
			if (krakenLive) this.kraken?.kill();
			return this.pump.handleCommand(command);
		}
		if (this.killed && (command.type === "resume" || command.type === "kraken_resume")) {
			this.killed = false;
			if (krakenLive) this.kraken?.resume();
			return this.pump.handleCommand({ type: "resume", id: command.id });
		}
		if (!isKraken(command)) return this.pump.handleCommand(command);
		if (!this.kraken) return ack({ ok: false, error: "Kraken desk is off" });
		if (!krakenLive) return ack({ ok: false, error: "Kraken desk is offline" });
		return ack(await this.kraken.handleCommand(command));
	}
}
