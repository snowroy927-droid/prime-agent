import {
	KRAKEN_HARD_LIMITS,
	type KrakenClosedTrade,
	type KrakenCommand,
	type KrakenEvent,
	type KrakenOrderUpdate,
	type KrakenSettings,
	type KrakenSnapshot,
	krakenOutcome,
	type Mover,
	type RuleStatus,
	type ScanStats,
} from "../../shared/kraken";
import type { Outcome } from "../../shared/outcome";
import { computeStatsOf } from "../../shared/stats";
import type { ExitReason, FeedStatus, Mode, Side } from "../../shared/types";
import type { Clock } from "../clock";
import type { RiskCopy, RiskGuard, RiskLimits } from "../risk/guard";
import type { JsonSettingsStore } from "../settingsStore";
import type { BarBook } from "./bars";
import type { KrakenFeedEvent, KrakenFeedLike } from "./feed";
import type { KrakenLedger } from "./ledger";
import { quoteSell, toScaled, USD_MICROS } from "./money";
import type { PairUniverse } from "./pairs";
import type { KrakenPaperExecutor } from "./paper";
import {
	evaluateKrakenExit,
	type KrakenPositionState,
	krakenFromLot,
	krakenIsStale,
	krakenRevalue,
	krakenToView,
} from "./positions";
import type { KrakenRestLike } from "./rest";
import { Scanner } from "./scanner";

export const KRAKEN_RISK_COPY: RiskCopy = {
	autoOff: "Auto-buy off",
	notApproved: "Not eligible",
	rejectedHold: "Hold to buy a pair the rule skipped",
};

export function krakenLimits(s: KrakenSettings): RiskLimits {
	return {
		maxPositions: s.maxPositions,
		auto: s.autoBuy,
		dailyLossCap: BigInt(Math.round(s.dailyLossCapUsd * 1_000_000)),
		tiltLosses: s.tiltLosses,
		tiltCooldownMin: s.tiltCooldownMin,
	};
}

export interface KrakenDeskDeps {
	mode: Mode;
	synthetic: boolean;
	feed: KrakenFeedLike;
	rest: KrakenRestLike;
	universe: PairUniverse;
	bars: BarBook;
	executor: KrakenPaperExecutor;
	ledger: KrakenLedger;
	settings: JsonSettingsStore<KrakenSettings>;
	risk: RiskGuard;
	clock: Clock;
	emit: (event: KrakenEvent) => void;
	tzOffsetMin: () => number;
}

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const SCAN_MS = 5_000;
const TICK_MS = 1_000;
const HOUR_MS = 3_600_000;
const PRICE_EVENT_MS = 250;
const SOL_EVENT_MS = 5_000;
const CLOSES_IN_SNAPSHOT = 500;
const SOL_WSNAME = "SOL/USD";

const SKIP_LABELS: Partial<Record<RuleStatus, string>> = {
	warming_up: "Warming up",
	low_volume: "Low volume",
	wide_spread: "Wide spread",
	not_rising: "Not rising",
	no_volume_surge: "No volume surge",
	held: "Already held",
	cooldown: "Re-entry cooldown",
};

// Risk reasons carry details (counts, times); the analytics group them by their stable prefix.
function riskLabel(reason: string): string {
	if (reason.startsWith("Tilt cooldown")) return "Tilt cooldown";
	if (reason.startsWith("Max positions")) return "Max positions reached";
	return reason;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Kraken REST OHLC rows are [time (unix s), open, high, low, close, vwap, volume, count]; the layout is
// unverified against live data (spec Section 2), so malformed rows are skipped.
function parseOhlc(result: unknown): { begin: number; close: number; volume: number }[] {
	if (typeof result !== "object" || result === null) return [];
	const rows = Object.values(result).find((value) => Array.isArray(value));
	if (!Array.isArray(rows)) return [];
	const bars: { begin: number; close: number; volume: number }[] = [];
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		const time = Number(row[0]);
		const close = Number(row[4]);
		const volume = Number(row[6]);
		if (!Number.isFinite(time) || !Number.isFinite(close) || !Number.isFinite(volume)) continue;
		bars.push({ begin: time < 1e12 ? time * 1000 : time, close, volume });
	}
	return bars;
}

export class KrakenDesk {
	private readonly scanner: Scanner;
	private readonly positions = new Map<string, KrakenPositionState>();
	private readonly positionByPair = new Map<string, string>();
	private readonly pendingBuys = new Map<string, bigint>();
	private readonly pinned = new Set<string>();
	private readonly lastExitAt = new Map<string, number>();
	private readonly lastPriceEvent = new Map<string, number>();
	private readonly lastStale = new Map<string, boolean>();
	private readonly orders = new Set<Promise<void>>();
	private readonly moverHours = new Map<number, Set<string>>();
	private readonly skipCounts = new Map<string, number>();
	private readonly skipSeen = new Set<string>();
	private readonly seedQueue: string[] = [];
	private closes: KrakenClosedTrade[] = [];
	private movers: Mover[] = [];
	private feedState: { status: FeedStatus; dropped: number; reconnectAt: number | null } = {
		status: "connecting",
		dropped: 0,
		reconnectAt: null,
	};
	private solUsd: { price: string; at: number } | null = null;
	private lastSolEvent = 0;
	private seeding = false;
	private killActive = false;
	private stopped = false;
	private lastRiskJson = "";
	private lastScanStatsJson = "";
	private readonly stops: (() => void)[] = [];

	constructor(private readonly deps: KrakenDeskDeps) {
		this.scanner = new Scanner({
			universe: deps.universe,
			bars: deps.bars,
			clock: deps.clock,
			settings: () => deps.settings.get(),
			held: (pair) => this.positionByPair.has(pair) || this.pendingBuys.has(pair),
			cooldownUntil: (pair) => {
				const exit = this.lastExitAt.get(pair);
				return exit === undefined ? null : exit + deps.settings.get().rule.reentryCooldownMin * 60_000;
			},
			tzOffsetMin: deps.tzOffsetMin,
		});
	}

	async start(): Promise<void> {
		const state = this.deps.ledger.load();
		for (const warning of state.warnings) this.log("warn", `Kraken: ${warning}`);
		this.closes = [...state.closed].sort((a, b) => a.closedAt - b.closedAt);
		for (const trade of this.closes) this.lastExitAt.set(trade.pair, trade.closedAt);
		for (const lot of state.open) {
			const position = krakenFromLot(lot);
			this.positions.set(position.id, position);
			this.positionByPair.set(position.pair, position.id);
		}
		await this.deps.universe.refresh();
		this.markHalted();
		this.stops.push(this.deps.universe.onChange(() => this.onUniverseChange()));
		this.stops.push(
			this.deps.universe.startHourlyRefresh((error) =>
				this.log("warn", `Kraken: pair list refresh failed (${message(error)})`),
			),
		);
		this.lastRiskJson = JSON.stringify(this.riskState());
		this.stops.push(this.deps.feed.on((event) => this.onFeed(event)));
		this.deps.feed.setSymbols(this.symbols());
		this.deps.feed.start();
		this.stops.push(this.deps.clock.every(SCAN_MS, () => void this.scanCycle()));
		this.stops.push(this.deps.clock.every(TICK_MS, () => this.tick()));
	}

	async stop(): Promise<void> {
		this.stopped = true;
		for (const stop of this.stops.splice(0)) stop();
		this.deps.feed.stop();
		await Promise.allSettled([...this.orders]);
	}

	quote(pair: string): { bid: string; ask: string; last: string; at: number } | null {
		return this.scanner.quote(pair);
	}

	isHalted(pair: string): boolean {
		const id = this.positionByPair.get(pair);
		return (id !== undefined && this.positions.get(id)?.halted === true) || !this.deps.universe.byPair(pair);
	}

	snapshot(): KrakenSnapshot {
		const now = this.deps.clock.now();
		const settings = this.deps.settings.get();
		return {
			error: null,
			feed: { ...this.feedState },
			movers: this.movers,
			positions: [...this.positions.values()].map((p) => krakenToView(p, now, settings)),
			closes: this.closes.slice(-CLOSES_IN_SNAPSHOT),
			stats: computeStatsOf(this.outcomes(), this.deps.tzOffsetMin(), Number(USD_MICROS)),
			scanStats: this.scanStats(),
			risk: this.riskState(),
			settings,
			pinned: [...this.pinned],
			balanceUsdMicros: this.balance().toString(),
			solUsd: this.solUsd,
		};
	}

	async handleCommand(command: KrakenCommand): Promise<Result> {
		switch (command.type) {
			case "kraken_buy": {
				if (!this.deps.universe.byPair(command.pair)) return fail("Unknown pair");
				const status = this.movers.find((mover) => mover.pair === command.pair)?.status;
				const decision = this.deps.risk.canOpen("manual", this.outcomes(), this.openCount(), {
					holdConfirmed: command.holdConfirmed ?? false,
					signal: status === "eligible" ? "approved" : "rejected",
				});
				if (!decision.ok) return fail(decision.reason);
				return this.placeBuy(command.pair, "manual");
			}
			case "kraken_sell": {
				const id = this.positionByPair.get(command.pair);
				const position = id ? this.positions.get(id) : undefined;
				if (!position) return fail("No open position");
				if (position.halted) return fail("Pair halted");
				return this.placeSell(position.id, command.pct, "manual", "manual");
			}
			case "kraken_pin": {
				if (!this.deps.universe.byPair(command.pair)) return fail("Unknown pair");
				if (this.pinned.has(command.pair)) return { ok: true };
				if (this.pinned.size >= KRAKEN_HARD_LIMITS.pinsMax)
					return fail(`Hotbar full (${KRAKEN_HARD_LIMITS.pinsMax} pins)`);
				this.pinned.add(command.pair);
				this.deps.emit({ type: "kraken_pinned", pairs: [...this.pinned] });
				return { ok: true };
			}
			case "kraken_unpin":
				this.pinned.delete(command.pair);
				this.deps.emit({ type: "kraken_pinned", pairs: [...this.pinned] });
				return { ok: true };
			case "kraken_pause":
				this.deps.risk.setPaused(true, "Paused by you");
				this.emitRisk(true);
				return { ok: true };
			case "kraken_resume":
				this.resume();
				return { ok: true };
			case "kraken_setSettings": {
				const result = this.deps.settings.update(command.patch);
				if (!result.ok) return fail(result.error);
				this.deps.emit({ type: "kraken_settings", settings: result.settings });
				this.emitRisk(false);
				return { ok: true };
			}
		}
	}

	// Sells everything and pauses; until resume(), fills that land later are sold too.
	kill(): void {
		this.killActive = true;
		for (const position of [...this.positions.values()]) {
			if (!position.pendingOrder && !position.halted) this.placeSell(position.id, 100, "exit", "kill");
		}
		this.deps.risk.setPaused(true, "Kill switch");
		this.emitRisk(true);
	}

	resume(): void {
		this.killActive = false;
		this.deps.risk.setPaused(false, null);
		this.emitRisk(true);
	}

	private symbols(): string[] {
		return [...new Set([...this.deps.universe.all().map((pair) => pair.wsname), SOL_WSNAME])];
	}

	private markHalted(): void {
		for (const position of [...this.positions.values()]) {
			const halted = !this.deps.universe.byPair(position.pair);
			if (halted === position.halted) continue;
			this.positions.set(position.id, { ...position, halted });
			if (halted) this.log("warn", `Kraken: ${position.symbol} halted`);
			this.emitPosition(position.id);
		}
	}

	private onUniverseChange(): void {
		this.markHalted();
		this.deps.feed.setSymbols(this.symbols());
	}

	private onFeed(event: KrakenFeedEvent): void {
		if (this.stopped) return;
		if (event.type === "status") {
			this.feedState = { status: event.status, dropped: event.dropped, reconnectAt: event.reconnectAt };
			this.deps.emit({ type: "kraken_feed", ...this.feedState });
			return;
		}
		if (event.type === "bar") {
			this.deps.bars.update({
				wsname: event.wsname,
				begin: event.begin,
				close: Number(event.close),
				volume: Number(event.volume),
			});
			return;
		}
		this.scanner.onTicker(event);
		if (event.wsname === SOL_WSNAME) this.onSolUsd(event.last, event.at);
		const pair = this.deps.universe.byWsName(event.wsname);
		if (!pair) return;
		const id = this.positionByPair.get(pair.pair);
		if (id) this.revalue(id);
		if (id || this.pinned.has(pair.pair)) {
			const last = this.lastPriceEvent.get(pair.pair) ?? 0;
			if (event.at - last >= PRICE_EVENT_MS) {
				this.lastPriceEvent.set(pair.pair, event.at);
				this.deps.emit({
					type: "kraken_price",
					pair: pair.pair,
					bid: event.bid,
					ask: event.ask,
					last: event.last,
					at: event.at,
				});
			}
		}
	}

	private onSolUsd(price: string, at: number): void {
		this.solUsd = { price, at };
		if (at - this.lastSolEvent < SOL_EVENT_MS) return;
		this.lastSolEvent = at;
		this.deps.emit({ type: "kraken_sol_usd", price, at });
	}

	private revalue(id: string): void {
		const position = this.positions.get(id);
		const pair = position ? this.deps.universe.byPair(position.pair) : undefined;
		const quote = position ? this.scanner.quote(position.pair) : null;
		if (!position || !pair || !quote || position.lots <= 0n) return;
		const sale = quoteSell(
			position.lots,
			toScaled(quote.bid, pair.priceDecimals),
			pair,
			this.deps.settings.get().paper,
		);
		if (!sale.ok) return;
		const next = krakenRevalue(position, sale.proceedsUsdMicros, quote.last, quote.at);
		this.positions.set(id, next);
		this.emitPosition(id);
		this.maybeExit(id);
	}

	private maybeExit(id: string): void {
		const position = this.positions.get(id);
		if (!position) return;
		const reason = evaluateKrakenExit(position, this.deps.clock.now(), this.deps.settings.get());
		if (reason) this.placeSell(id, 100, "exit", reason);
	}

	private tick(): void {
		if (this.stopped) return;
		const now = this.deps.clock.now();
		const settings = this.deps.settings.get();
		for (const [id, position] of [...this.positions.entries()]) {
			const stale = krakenIsStale(position, now, settings);
			if (this.lastStale.get(id) !== stale) {
				this.lastStale.set(id, stale);
				this.emitPosition(id);
			}
			this.maybeExit(id);
		}
		this.emitRisk(false);
	}

	private async scanCycle(): Promise<void> {
		if (this.stopped) return;
		await this.seedPending();
		if (this.stopped) return;
		const settings = this.deps.settings.get();
		const now = this.deps.clock.now();
		this.movers = this.scanner.scan();
		this.deps.emit({ type: "kraken_movers", movers: this.movers });
		const hour = Math.floor(now / HOUR_MS);
		for (const mover of this.movers) {
			if (mover.change15m === null || mover.change15m < settings.rule.minChange15mPct) continue;
			const bucket = this.moverHours.get(hour) ?? new Set<string>();
			bucket.add(mover.pair);
			this.moverHours.set(hour, bucket);
			if (mover.status !== "eligible") {
				this.countSkip(mover.pair, SKIP_LABELS[mover.status] ?? mover.reason, hour);
				continue;
			}
			const decision = this.deps.risk.canOpen("auto", this.outcomes(), this.openCount(), {
				holdConfirmed: false,
				signal: "approved",
			});
			if (!decision.ok) {
				this.countSkip(mover.pair, riskLabel(decision.reason), hour);
				continue;
			}
			const placed = this.placeBuy(mover.pair, "auto");
			if (!placed.ok) this.countSkip(mover.pair, placed.error, hour);
		}
		for (const key of [...this.moverHours.keys()]) if (key <= hour - 24) this.moverHours.delete(key);
		const scanStats = this.scanStats();
		const json = JSON.stringify(scanStats);
		if (json !== this.lastScanStatsJson) {
			this.lastScanStatsJson = json;
			this.emitStats();
		}
	}

	// Each pair and reason counts once per hour, so a mover skipped on every 5 s scan is one skip.
	private countSkip(pair: string, reason: string, hour: number): void {
		const key = `${hour}|${pair}|${reason}`;
		if (this.skipSeen.has(key)) return;
		this.skipSeen.add(key);
		this.skipCounts.set(reason, (this.skipCounts.get(reason) ?? 0) + 1);
	}

	private async seedPending(): Promise<void> {
		this.seedQueue.push(...this.scanner.needsSeed());
		if (this.seeding) return;
		this.seeding = true;
		try {
			while (this.seedQueue.length > 0 && !this.stopped) {
				const wsname = this.seedQueue.shift() ?? "";
				const pair = this.deps.universe.byWsName(wsname);
				if (!pair) continue;
				try {
					this.deps.bars.seed(wsname, parseOhlc(await this.deps.rest.ohlc(pair.pair)));
				} catch (error) {
					this.log("warn", `Kraken: no candle history for ${pair.symbol} (${message(error)}); using live bars`);
				}
			}
		} finally {
			this.seeding = false;
		}
	}

	private placeBuy(pair: string, source: KrakenOrderUpdate["source"]): Result {
		if (this.positionByPair.has(pair)) return fail("Already holding");
		if (this.pendingBuys.has(pair)) return fail("Order already pending");
		const known = this.deps.universe.byPair(pair);
		if (!known) return fail("Unknown pair");
		const settings = this.deps.settings.get();
		const amount = BigInt(Math.round(settings.buyUsd * 1_000_000));
		const feeBps = BigInt(Math.round(settings.paper.takerFeePct * 100));
		const reserved = amount + (amount * feeBps + 9_999n) / 10_000n;
		if (reserved > this.balance()) return fail("Insufficient paper balance");

		const positionId = crypto.randomUUID();
		const order = this.orderFactory(positionId, pair, known.symbol, "buy", source);
		this.pendingBuys.set(pair, reserved);
		this.deps.emit({ type: "kraken_order", order: order("pending") });
		this.track(async () => {
			const result = await this.deps.executor.buy({ positionId, pair, usdMicros: amount });
			this.pendingBuys.delete(pair);
			if (!result.ok) {
				this.deps.emit({ type: "kraken_order", order: order("failed", result.error) });
				this.emitBalance();
				return;
			}
			const { fill } = result;
			this.deps.ledger.appendFill(fill);
			const position = krakenFromLot({
				positionId,
				mode: fill.mode,
				pair,
				symbol: known.symbol,
				openedAt: fill.ts,
				costUsdMicros: BigInt(fill.usdMicros) + BigInt(fill.feesUsdMicros),
				proceedsUsdMicros: 0n,
				lots: BigInt(fill.lots),
			});
			this.positions.set(positionId, position);
			this.positionByPair.set(pair, positionId);
			this.deps.emit({ type: "kraken_order", order: order("filled") });
			this.log("info", `Kraken: bought ${known.symbol}`);
			this.emitBalance();
			this.revalue(positionId);
			this.emitPosition(positionId);
			if (this.killActive) this.placeSell(positionId, 100, "exit", "kill");
		});
		return { ok: true };
	}

	private placeSell(
		positionId: string,
		pct: 50 | 100,
		source: KrakenOrderUpdate["source"],
		reason: ExitReason,
	): Result {
		const position = this.positions.get(positionId);
		if (!position) return fail("No open position");
		if (position.pendingOrder) return fail("Order already pending");
		const lots = pct === 100 ? position.lots : position.lots / 2n;
		if (lots <= 0n) return fail("Nothing to sell");

		const order = this.orderFactory(positionId, position.pair, position.symbol, "sell", source);
		this.positions.set(positionId, { ...position, pendingOrder: true });
		this.deps.emit({ type: "kraken_order", order: order("pending") });
		this.emitPosition(positionId);
		this.track(async () => {
			const result = await this.deps.executor.sell({ positionId, pair: position.pair, lots });
			const current = this.positions.get(positionId);
			if (!current) return;
			if (!result.ok) {
				this.positions.set(positionId, { ...current, pendingOrder: false });
				this.deps.emit({ type: "kraken_order", order: order("failed", result.error) });
				this.emitPosition(positionId);
				return;
			}
			const { fill } = result;
			this.deps.ledger.appendFill(fill);
			this.deps.emit({ type: "kraken_order", order: order("filled") });
			const proceeds = current.proceedsUsdMicros + BigInt(fill.usdMicros) - BigInt(fill.feesUsdMicros);
			const remaining = current.lots - lots;
			if (remaining <= 0n) {
				this.closePosition({ ...current, proceedsUsdMicros: proceeds, lots: 0n }, reason);
				return;
			}
			this.positions.set(positionId, {
				...current,
				proceedsUsdMicros: proceeds,
				lots: remaining,
				pendingOrder: false,
			});
			this.revalue(positionId);
			this.emitPosition(positionId);
			this.emitBalance();
			if (this.killActive) this.placeSell(positionId, 100, "exit", "kill");
		});
		return { ok: true };
	}

	private closePosition(position: KrakenPositionState, reason: ExitReason): void {
		const now = this.deps.clock.now();
		const pnl = position.proceedsUsdMicros - position.costUsdMicros;
		const pnlPct = position.costUsdMicros === 0n ? 0 : (Number(pnl) / Number(position.costUsdMicros)) * 100;
		this.deps.ledger.appendClose({
			positionId: position.id,
			mode: position.mode,
			pnlUsdMicros: pnl.toString(),
			pnlPct,
			reason,
			ts: now,
		});
		const trade: KrakenClosedTrade = {
			positionId: position.id,
			mode: position.mode,
			pair: position.pair,
			symbol: position.symbol,
			costUsdMicros: position.costUsdMicros.toString(),
			proceedsUsdMicros: position.proceedsUsdMicros.toString(),
			pnlUsdMicros: pnl.toString(),
			pnlPct,
			reason,
			openedAt: position.openedAt,
			closedAt: now,
		};
		this.closes.push(trade);
		this.positions.delete(position.id);
		this.positionByPair.delete(position.pair);
		this.lastStale.delete(position.id);
		this.lastExitAt.set(position.pair, now);
		this.deps.emit({ type: "kraken_close", trade });
		this.log(
			"info",
			`Kraken: ${position.symbol} closed ${(Number(pnl) / 1_000_000).toFixed(2)} USD (${reason.replace("_", " ")})`,
		);
		this.emitStats();
		this.emitRisk(true);
		this.emitBalance();
	}

	private track(run: () => Promise<void>): void {
		const promise = run().catch((error) => this.log("error", `Kraken: order handling failed (${message(error)})`));
		this.orders.add(promise);
		void promise.finally(() => this.orders.delete(promise));
	}

	private orderFactory(
		positionId: string,
		pair: string,
		symbol: string,
		side: Side,
		source: KrakenOrderUpdate["source"],
	): (status: KrakenOrderUpdate["status"], error?: string) => KrakenOrderUpdate {
		const id = crypto.randomUUID();
		return (status, error) => ({
			id,
			positionId,
			pair,
			symbol,
			side,
			status,
			source,
			...(error === undefined ? {} : { error }),
			at: this.deps.clock.now(),
		});
	}

	private outcomes(): Outcome[] {
		return this.closes.map(krakenOutcome);
	}

	private openCount(): number {
		return this.positions.size + this.pendingBuys.size;
	}

	private balance(): bigint {
		let balance = BigInt(Math.round(this.deps.settings.get().paper.startingBalanceUsd * 1_000_000));
		for (const trade of this.closes) balance += BigInt(trade.pnlUsdMicros);
		for (const position of this.positions.values()) balance -= position.costUsdMicros - position.proceedsUsdMicros;
		for (const pending of this.pendingBuys.values()) balance -= pending;
		return balance;
	}

	private scanStats(): ScanStats {
		const hour = Math.floor(this.deps.clock.now() / HOUR_MS);
		return {
			moversPerHour: Array.from({ length: 24 }, (_, i) => this.moverHours.get(hour - 23 + i)?.size ?? 0),
			skipReasons: [...this.skipCounts.entries()]
				.map(([reason, count]) => ({ reason, count }))
				.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
		};
	}

	private riskState() {
		return this.deps.risk.state(this.outcomes());
	}

	private emitPosition(id: string): void {
		const position = this.positions.get(id);
		if (!position) return;
		const settings = this.deps.settings.get();
		this.deps.emit({ type: "kraken_position", position: krakenToView(position, this.deps.clock.now(), settings) });
	}

	private emitStats(): void {
		this.deps.emit({
			type: "kraken_stats",
			stats: computeStatsOf(this.outcomes(), this.deps.tzOffsetMin(), Number(USD_MICROS)),
			scanStats: this.scanStats(),
		});
	}

	private emitRisk(force: boolean): void {
		const risk = this.riskState();
		const json = JSON.stringify(risk);
		if (!force && json === this.lastRiskJson) return;
		this.lastRiskJson = json;
		this.deps.emit({ type: "kraken_risk", risk });
	}

	private emitBalance(): void {
		this.deps.emit({ type: "kraken_balance", usdMicros: this.balance().toString() });
	}

	private log(level: "info" | "warn" | "error", text: string): void {
		this.deps.emit({ type: "log", line: { level, message: text, at: this.deps.clock.now() } });
	}
}
