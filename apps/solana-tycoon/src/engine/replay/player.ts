import type {
	ChainSource,
	CurveSnapshot,
	Globals,
	HolderSummary,
	PoolSnapshot,
	TokenProgramKind,
} from "../chain/types";
import type { Clock } from "../clock";
import { fromJsonSafe } from "../codec";
import { parsePumpPortalMessage } from "../feed/parse";
import type { FeedEvent, LaunchFeed } from "../feed/types";
import type { RecordingLine } from "./recording";

type Listener<T> = (snapshot: T) => void;

export class ReplayChain implements ChainSource {
	private slot = 0;
	private readonly curves = new Map<string, CurveSnapshot>();
	private readonly pools = new Map<string, PoolSnapshot>();
	private readonly holders = new Map<string, HolderSummary>();
	private readonly curveListeners = new Map<string, Set<Listener<CurveSnapshot>>>();
	private readonly poolListeners = new Map<string, Set<Listener<PoolSnapshot>>>();

	constructor(
		private readonly globals: Globals | null,
		private readonly clock: Clock,
	) {}

	applyCurve(mint: string, encoded: unknown): void {
		const decoded = fromJsonSafe(encoded) as CurveSnapshot;
		const snapshot: CurveSnapshot = { ...decoded, mint, slot: ++this.slot, at: this.clock.now() };
		this.curves.set(mint, snapshot);
		for (const listener of [...(this.curveListeners.get(mint) ?? [])]) listener(snapshot);
	}

	applyPool(mint: string, encoded: unknown): void {
		const decoded = fromJsonSafe(encoded) as PoolSnapshot;
		const snapshot: PoolSnapshot = { ...decoded, mint, slot: ++this.slot, at: this.clock.now() };
		this.pools.set(mint, snapshot);
		for (const listener of [...(this.poolListeners.get(mint) ?? [])]) listener(snapshot);
	}

	applyHolders(mint: string, encoded: unknown): void {
		this.holders.set(mint, fromJsonSafe(encoded) as HolderSummary);
	}

	async fetchGlobals(): Promise<Globals> {
		if (!this.globals) throw new Error("Recording has no globals line");
		return this.globals;
	}

	async fetchCurve(mint: string): Promise<CurveSnapshot | null> {
		return this.curves.get(mint) ?? null;
	}

	watchCurve(mint: string, onUpdate: Listener<CurveSnapshot>): () => void {
		return listen(this.curveListeners, mint, onUpdate);
	}

	async fetchHolders(mint: string, _tokenProgram: TokenProgramKind): Promise<HolderSummary> {
		const summary = this.holders.get(mint);
		if (!summary) throw new Error(`Recording has no holder data for ${mint}`);
		return summary;
	}

	async fetchPool(mint: string): Promise<PoolSnapshot | null> {
		return this.pools.get(mint) ?? null;
	}

	watchPool(mint: string, onUpdate: Listener<PoolSnapshot>): () => void {
		return listen(this.poolListeners, mint, onUpdate);
	}

	health(): { degraded: boolean } {
		return { degraded: false };
	}
}

function listen<T>(map: Map<string, Set<Listener<T>>>, mint: string, listener: Listener<T>): () => void {
	const set = map.get(mint) ?? new Set<Listener<T>>();
	set.add(listener);
	map.set(mint, set);
	return () => {
		set.delete(listener);
	};
}

export class ReplayFeed implements LaunchFeed {
	private readonly listeners = new Set<(event: FeedEvent) => void>();

	constructor(
		private readonly onStart: () => void,
		private readonly onStop: () => void,
	) {}

	start(): void {
		this.onStart();
	}

	stop(): void {
		this.onStop();
	}

	on(listener: (event: FeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: FeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}

// Plays a recording: a line at t ms dispatches t ms after start on the driver's clock (a ScaledClock for --speed).
export class ReplayDriver {
	readonly feed: ReplayFeed;
	readonly chain: ReplayChain;
	readonly synthetic: boolean;
	private readonly lines: RecordingLine[];
	private running = false;
	private generation = 0;
	private startedAt = 0;

	constructor(
		lines: readonly RecordingLine[],
		private readonly clock: Clock,
	) {
		this.lines = [...lines].sort((a, b) => a.t - b.t);
		const meta = this.lines.find((line) => line.kind === "meta");
		this.synthetic = meta?.kind === "meta" ? meta.synthetic : false;
		const globalsLine = this.lines.find((line) => line.kind === "globals");
		const globals = globalsLine?.kind === "globals" ? (fromJsonSafe(globalsLine.globals) as Globals) : null;
		this.chain = new ReplayChain(globals, clock);
		this.feed = new ReplayFeed(
			() => this.start(),
			() => this.stop(),
		);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.generation += 1;
		this.startedAt = this.clock.now();
		void this.run(this.generation);
	}

	stop(): void {
		this.running = false;
	}

	private dueAt(line: RecordingLine): number {
		return this.startedAt + line.t;
	}

	private async run(generation: number): Promise<void> {
		for (let index = 0; index < this.lines.length; index++) {
			const line = this.lines[index];
			const wait = this.dueAt(line) - this.clock.now();
			if (wait > 0) await this.clock.sleep(wait);
			if (!this.running || generation !== this.generation) return;
			this.dispatch(line, index);
		}
	}

	private dispatch(line: RecordingLine, index: number): void {
		switch (line.kind) {
			case "launch": {
				const parsed = parsePumpPortalMessage(line.raw, this.clock.now());
				if (parsed.kind === "launch") this.feed.emit({ type: "launch", launch: parsed.launch, raw: line.raw });
				else if (parsed.kind === "migration") this.feed.emit({ type: "migration", mint: parsed.mint });
				break;
			}
			case "curve":
				this.chain.applyCurve(line.mint, line.snap);
				break;
			case "pool":
				this.chain.applyPool(line.mint, line.pool);
				break;
			case "holders":
				this.chain.applyHolders(line.mint, line.holders);
				break;
			case "feed": {
				const next = this.lines.slice(index + 1).find((candidate) => candidate.kind === "feed");
				const reconnectAt = line.status === "down" && next ? this.dueAt(next) : null;
				this.feed.emit({ type: "status", status: line.status, dropped: 0, reconnectAt });
				break;
			}
			case "meta":
			case "globals":
			case "kraken_ws":
			case "kraken_rest":
			case "kraken_feed":
				break;
		}
	}
}
