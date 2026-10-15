import { DEFAULT_KRAKEN_SETTINGS, type KrakenSnapshot } from "../../shared/kraken";
import type { Ack, Command, EngineSnapshot, PumpCommand } from "../../shared/protocol";
import { computeStatsOf } from "../../shared/stats";
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

// A failed Kraken start is retried after 30 s, doubling up to 5 minutes, until it succeeds.
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 300_000;

// The Kraken section shown when the desk could not even be built (for example, a corrupt settings file).
function offlineKrakenSnapshot(error: string): KrakenSnapshot {
	const settings = DEFAULT_KRAKEN_SETTINGS;
	return {
		error,
		feed: { status: "down", dropped: 0, reconnectAt: null },
		movers: [],
		positions: [],
		closes: [],
		stats: computeStatsOf([], 0, 1_000_000),
		scanStats: { moversPerHour: Array(24).fill(0), skipReasons: [] },
		risk: {
			auto: settings.autoBuy,
			paused: false,
			pausedReason: null,
			tiltLosses: 0,
			tiltUntil: null,
			dailyPnl: "0",
			dailyCapUntil: null,
		},
		settings,
		pinned: [],
		balanceUsdMicros: (BigInt(settings.paper.startingBalanceUsd) * 1_000_000n).toString(),
		solUsd: null,
	};
}

export interface EngineDeps {
	bus: EngineBus;
	clock: Clock;
	// Why the Kraken desk could not be built, when it could not; pump.fun runs regardless.
	krakenFailure?: string;
}

// One snapshot and one command stream over the pump.fun desk and, when on, the Kraken desk. KILL acts on both
// desks; after a kill, RESUME from either desk lifts it on both. Outside a kill, pause and resume stay per desk.
// The Kraken desk starts in the background, so a slow or unreachable Kraken never holds up pump.fun or the page.
export class Engine {
	private krakenError: string | null;
	private krakenAttempt: Promise<void> = Promise.resolve();
	private killed = false;
	private stopped = false;

	constructor(
		private readonly pump: PumpDesk,
		private readonly kraken: KrakenDeskLike | null,
		private readonly deps: EngineDeps,
	) {
		this.krakenError = deps.krakenFailure ?? null;
	}

	async start(): Promise<void> {
		await this.pump.start();
		if (this.krakenError !== null) this.reportOffline(this.krakenError);
		if (this.kraken) this.krakenAttempt = this.startKraken(0);
	}

	// Resolves when the current Kraken start attempt has finished, successfully or not.
	krakenSettled(): Promise<void> {
		return this.krakenAttempt;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		await Promise.all([this.pump.stop(), this.kraken?.stop()]);
	}

	snapshot(): EngineSnapshot {
		const kraken = this.kraken
			? { ...this.kraken.snapshot(), error: this.krakenError }
			: this.krakenError !== null
				? offlineKrakenSnapshot(this.krakenError)
				: null;
		return { ...this.pump.snapshot(), kraken };
	}

	private async startKraken(attempt: number): Promise<void> {
		const kraken = this.kraken;
		if (!kraken || this.stopped) return;
		try {
			await kraken.start();
			if (this.stopped || this.krakenError === null) return;
			this.krakenError = null;
			this.log("info", "Kraken: desk online");
			this.deps.bus.emit({ type: "snapshot", snapshot: this.snapshot() });
		} catch (error) {
			const text = message(error);
			if (text !== this.krakenError) this.reportOffline(text);
			this.krakenError = text;
			const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
			void this.deps.clock.sleep(delay).then(() => {
				if (!this.stopped) this.krakenAttempt = this.startKraken(attempt + 1);
			});
		}
	}

	private reportOffline(error: string): void {
		this.deps.bus.emit({ type: "kraken_offline", error });
		this.log("error", `Kraken: desk offline (${error})`);
	}

	private log(level: "info" | "error", text: string): void {
		this.deps.bus.emit({ type: "log", line: { level, message: text, at: this.deps.clock.now() } });
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
		if (!this.kraken && this.krakenError === null) return ack({ ok: false, error: "Kraken desk is off" });
		if (!krakenLive) return ack({ ok: false, error: "Kraken desk is offline" });
		return ack(await this.kraken.handleCommand(command));
	}
}
