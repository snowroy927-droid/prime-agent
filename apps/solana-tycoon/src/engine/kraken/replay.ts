import type { Clock } from "../clock";
import type { RecordingLine } from "../replay/recording";
import { type KrakenFeedEvent, type KrakenFeedLike, parseKrakenMessage } from "./feed";
import type { PairUniverse } from "./pairs";
import { KrakenRestError, type KrakenRestLike } from "./rest";

type KrakenLine = Extract<RecordingLine, { kind: "kraken_ws" | "kraken_rest" | "kraken_feed" }>;
type RestLine = Extract<RecordingLine, { kind: "kraken_rest" }>;

const isKrakenLine = (line: RecordingLine): line is KrakenLine =>
	line.kind === "kraken_ws" || line.kind === "kraken_rest" || line.kind === "kraken_feed";

// OHLC rows are [time, ...]; Kraken sends unix seconds. Shifted rows carry milliseconds, which the desk's
// candle parser accepts, so no precision is lost to a fractional-second shift.
function shiftCandles(result: unknown, shift: number): unknown {
	if (typeof result !== "object" || result === null) return result;
	return Object.fromEntries(
		Object.entries(result).map(([key, value]) => [
			key,
			Array.isArray(value)
				? value.map((row) =>
						Array.isArray(row) && typeof row[0] === "number"
							? [(row[0] < 1e12 ? Math.round(row[0] * 1000) : row[0]) + shift, ...row.slice(1)]
							: row,
					)
				: value,
		]),
	);
}

// Plays the Kraken part of a recording as both the desk's feed and its REST client. WebSocket messages and feed
// status dispatch at their recorded times; REST calls answer from recorded bodies. Timestamps inside recorded
// market data move by (replay start - recording start), so candle history lines up with the replay clock.
export class ReplayKrakenSource implements KrakenFeedLike, KrakenRestLike {
	readonly synthetic: boolean;
	private readonly lines: KrakenLine[];
	private readonly rest = new Map<string, RestLine[]>();
	private readonly listeners = new Set<(event: KrakenFeedEvent) => void>();
	private readonly startedAt: number;
	private readonly shift: number;
	private running = false;
	private generation = 0;
	private dropped = 0;
	private status: KrakenFeedEvent & { type: "status" } = {
		type: "status",
		status: "connecting",
		dropped: 0,
		reconnectAt: null,
	};

	constructor(
		lines: readonly RecordingLine[],
		private readonly clock: Clock,
		private readonly universe: () => PairUniverse | null,
	) {
		this.lines = lines.filter(isKrakenLine).sort((a, b) => a.t - b.t);
		const meta = lines.find((line) => line.kind === "meta");
		this.synthetic = meta?.kind === "meta" && meta.synthetic;
		this.startedAt = clock.now();
		const recordedAt = meta?.kind === "meta" ? Date.parse(meta.createdAt) : Number.NaN;
		this.shift = Number.isNaN(recordedAt) ? 0 : this.startedAt - recordedAt;
		for (const line of this.lines) {
			if (line.kind !== "kraken_rest") continue;
			const key = `${line.endpoint} ${line.query}`;
			this.rest.set(key, [...(this.rest.get(key) ?? []), line]);
		}
	}

	// A recording plays every message it holds, whatever the desk subscribes to.
	setSymbols(_wsnames: readonly string[]): void {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.generation += 1;
		void this.run(this.generation);
	}

	stop(): void {
		this.running = false;
	}

	on(listener: (event: KrakenFeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async assetPairs(): Promise<unknown> {
		return this.recorded("AssetPairs", "");
	}

	async ticker(pairs: readonly string[]): Promise<unknown> {
		return this.recorded("Ticker", pairs.join(","));
	}

	async ohlc(pair: string): Promise<unknown> {
		return shiftCandles(this.recorded("OHLC", pair), this.shift);
	}

	// The latest body recorded at or before now. A response recorded just after the replayed request was sent
	// still answers it, so a query recorded only later returns its first body.
	private recorded(endpoint: RestLine["endpoint"], query: string): unknown {
		const lines = this.rest.get(`${endpoint} ${query}`);
		if (!lines || lines.length === 0) throw new KrakenRestError("Not in recording");
		const elapsed = this.clock.now() - this.startedAt;
		let chosen = lines[0];
		for (const line of lines) if (line.t <= elapsed) chosen = line;
		return structuredClone(chosen.body);
	}

	private async run(generation: number): Promise<void> {
		for (let index = 0; index < this.lines.length; index++) {
			const line = this.lines[index];
			const wait = this.startedAt + line.t - this.clock.now();
			if (wait > 0) await this.clock.sleep(wait);
			if (!this.running || generation !== this.generation) return;
			this.dispatch(line, index);
		}
	}

	private dispatch(line: KrakenLine, index: number): void {
		switch (line.kind) {
			case "kraken_ws": {
				const parsed = parseKrakenMessage(line.raw, this.clock.now());
				if (parsed.kind === "events") {
					for (const event of parsed.events) {
						this.emit(event.type === "bar" ? { ...event, begin: event.begin + this.shift } : event);
					}
				} else if (parsed.kind === "invalid") {
					this.dropped += 1;
					this.emit({ ...this.status, dropped: this.dropped });
				}
				break;
			}
			case "kraken_feed": {
				const next = this.lines.slice(index + 1).find((candidate) => candidate.kind === "kraken_feed");
				const reconnectAt = line.status === "down" && next ? this.startedAt + next.t : null;
				this.status = { type: "status", status: line.status, dropped: this.dropped, reconnectAt };
				this.emit(this.status);
				break;
			}
			case "kraken_rest":
				if (line.endpoint === "AssetPairs") this.universe()?.apply(structuredClone(line.body));
				break;
		}
	}

	private emit(event: KrakenFeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
