import type { Ack, Command, EngineEvent, EngineSnapshot } from "../../shared/protocol";
import { computeLaunchStats, computeStats } from "../../shared/stats";
import type {
	CheckResult,
	ClosedTrade,
	ExitReason,
	FeedStatus,
	Launch,
	LogLine,
	Mode,
	OrderUpdate,
	Side,
} from "../../shared/types";
import { BASE_FEE_LAMPORTS, haircut, solToLamports } from "../../shared/units";
import type { EngineBus } from "../bus";
import type { RpcBudget } from "../chain/rpcBudget";
import { pump } from "../chain/solana";
import type { ChainSource, CurveSnapshot, Globals, PoolSnapshot } from "../chain/types";
import type { Clock } from "../clock";
import { isValidMint } from "../feed/parse";
import type { FeedEvent, LaunchFeed } from "../feed/types";
import type { Ledger } from "../ledger/ledger";
import type { RiskGuard } from "../risk/guard";
import type { LaunchHistory } from "../scout/launchHistory";
import { HARD_RULES } from "../scout/rugcheck";
import type { Scout } from "../scout/scout";
import type { SettingsStore } from "../settingsStore";
import type { Executor } from "../trader/executor";
import { evaluateExit, fromLot, isStale, type PositionState, revalue, toView } from "../trader/positions";
import {
	curveMarketCapSol,
	curvePriceSol,
	poolPriceSol,
	quotePoolSellLamports,
	quoteSellLamports,
} from "../trader/quote";

export interface CoreDeps {
	mode: Mode;
	synthetic: boolean;
	feed: LaunchFeed;
	chain: ChainSource;
	executor: Executor;
	ledger: Ledger;
	history: LaunchHistory;
	scout: Scout;
	risk: RiskGuard;
	budget: RpcBudget;
	clock: Clock;
	bus: EngineBus;
	settings: SettingsStore;
	publicRpcFallback: boolean;
	// Engine milliseconds per wall-clock millisecond (the replay speed); defaults to 1.
	clockRate?: number;
	tzOffsetMin: () => number;
	onRaw?: (raw: string) => void;
}

type Result = { ok: true } | { ok: false; error: string };

const RADAR_MAX = 50;
const CLOSES_IN_SNAPSHOT = 500;
const WATCH_MAX = 10;
const DAY_MS = 86_400_000;
const GLOBALS_RETRY_MS = 10_000;

const fail = (error: string): Result => ({ ok: false, error });
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function isMigrated(snapshot: CurveSnapshot): boolean {
	return snapshot.curve.complete || pump.isBondingCurveMigrated(snapshot.curve);
}

export class TradingCore {
	private readonly positions = new Map<string, PositionState>();
	private readonly positionByMint = new Map<string, string>();
	private readonly pendingBuys = new Map<string, bigint>();
	private readonly radar: { launch: Launch; check: CheckResult | null }[] = [];
	private recentLaunches: Launch[] = [];
	private readonly latestChecks = new Map<string, CheckResult>();
	private closes: ClosedTrade[] = [];
	private readonly pinned = new Set<string>();
	private readonly watches = new Map<string, { kind: "curve" | "pool"; stop: () => void }>();
	private readonly lastStale = new Map<string, boolean>();
	private readonly orders = new Set<Promise<void>>();
	private feedState: { status: FeedStatus; dropped: number; reconnectAt: number | null } = {
		status: "connecting",
		dropped: 0,
		reconnectAt: null,
	};
	private loadedGlobals: Globals | null = null;
	private nextGlobalsAttempt = 0;
	private lastRiskJson = "";
	private stopped = false;
	private stopTicker: (() => void) | null = null;
	private offFeed: (() => void) | null = null;

	constructor(private readonly deps: CoreDeps) {}

	globals(): Globals {
		if (!this.loadedGlobals) throw new Error("Pump globals not loaded yet");
		return this.loadedGlobals;
	}

	async start(): Promise<void> {
		const state = this.deps.ledger.load();
		for (const warning of state.warnings) this.log("warn", warning);
		this.closes = [...state.closed].sort((a, b) => a.closedAt - b.closedAt);
		await this.loadGlobals();
		for (const lot of state.open) {
			const position = fromLot(lot);
			this.positions.set(position.id, position);
			this.positionByMint.set(position.mint, position.id);
		}
		for (const position of [...this.positions.values()]) await this.resumePosition(position);
		this.lastRiskJson = JSON.stringify(this.deps.risk.state(this.closes));
		this.offFeed = this.deps.feed.on((event) => this.onFeed(event));
		this.deps.feed.start();
		this.stopTicker = this.deps.clock.every(1_000, () => this.tick());
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.offFeed?.();
		this.deps.feed.stop();
		this.stopTicker?.();
		for (const watch of this.watches.values()) watch.stop();
		this.watches.clear();
		await Promise.allSettled([...this.orders]);
	}

	snapshot(): EngineSnapshot {
		const now = this.deps.clock.now();
		const settings = this.deps.settings.get();
		return {
			mode: this.deps.mode,
			synthetic: this.deps.synthetic,
			feed: { ...this.feedState },
			rpc: { publicFallback: this.deps.publicRpcFallback, degraded: this.deps.chain.health().degraded },
			launches: this.radar.map((entry) => ({ launch: entry.launch, check: entry.check })),
			positions: [...this.positions.values()].map((position) => toView(position, now, settings)),
			closes: this.closes.slice(-CLOSES_IN_SNAPSHOT),
			stats: computeStats(this.closes, this.deps.tzOffsetMin()),
			launchStats: computeLaunchStats(this.recentLaunches, [...this.latestChecks.values()], now),
			risk: this.deps.risk.state(this.closes),
			settings,
			pinned: [...this.pinned],
			balanceLamports: this.balanceLamports().toString(),
			serverTime: now,
			clockRate: this.deps.clockRate ?? 1,
		};
	}

	async handleCommand(command: Command): Promise<Ack> {
		const ack = (result: Result): Ack =>
			result.ok
				? { type: "ack", id: command.id, ok: true }
				: { type: "ack", id: command.id, ok: false, error: result.error };
		switch (command.type) {
			case "snipe": {
				if (!isValidMint(command.mint)) return ack(fail("Invalid mint"));
				const decision = this.deps.risk.canOpen("manual", this.closes, this.openCount(), {
					holdConfirmed: command.holdConfirmed ?? false,
					checkVerdict: this.latestChecks.get(command.mint)?.verdict ?? null,
				});
				if (!decision.ok) return ack(fail(decision.reason));
				return ack(this.placeBuy(command.mint, this.symbolFor(command.mint), "manual"));
			}
			case "sell": {
				const positionId = this.positionByMint.get(command.mint);
				if (!positionId) return ack(fail("No open position"));
				return ack(this.placeSell(positionId, command.pct, "manual", "manual"));
			}
			case "pin": {
				if (!isValidMint(command.mint)) return ack(fail("Invalid mint"));
				if (this.pinned.has(command.mint)) return ack({ ok: true });
				const watched = new Set([...this.pinned, ...this.positionByMint.keys()]);
				if (!watched.has(command.mint) && watched.size >= WATCH_MAX) return ack(fail("Watch limit reached"));
				this.pinned.add(command.mint);
				this.watchCoin(command.mint);
				this.emit({ type: "pinned", mints: [...this.pinned] });
				return ack({ ok: true });
			}
			case "unpin": {
				this.pinned.delete(command.mint);
				this.unwatchIfIdle(command.mint);
				this.emit({ type: "pinned", mints: [...this.pinned] });
				return ack({ ok: true });
			}
			case "pause":
				this.deps.risk.setPaused(true, "Paused by you");
				this.emitRisk(true);
				return ack({ ok: true });
			case "resume":
				this.deps.risk.setPaused(false, null);
				this.emitRisk(true);
				return ack({ ok: true });
			case "kill": {
				for (const position of [...this.positions.values()]) {
					if (!position.pendingOrder) this.placeSell(position.id, 100, "exit", "kill");
				}
				this.deps.risk.setPaused(true, "Kill switch");
				this.emitRisk(true);
				return ack({ ok: true });
			}
			case "setSettings": {
				const result = this.deps.settings.update(command.patch);
				if (!result.ok) return ack(fail(result.error));
				this.emit({ type: "settings", settings: result.settings });
				this.emitRisk(false);
				return ack({ ok: true });
			}
		}
	}

	private async loadGlobals(): Promise<void> {
		try {
			this.loadedGlobals = await this.deps.chain.fetchGlobals();
		} catch (error) {
			this.nextGlobalsAttempt = this.deps.clock.now() + GLOBALS_RETRY_MS;
			this.log("error", `Could not load pump globals (${message(error)}); retrying`);
		}
	}

	private async resumePosition(position: PositionState): Promise<void> {
		try {
			const curve = await this.deps.chain.fetchCurve(position.mint);
			if (curve && !isMigrated(curve)) {
				this.onCurve(curve);
				this.watchCoin(position.mint);
				return;
			}
			const pool = await this.deps.chain.fetchPool(position.mint);
			if (pool) {
				this.setPosition({ ...(this.positionFor(position.mint) ?? position), migrated: true });
				this.onPool(pool);
				this.watchPool(position.mint);
				return;
			}
			this.log("warn", `${position.symbol}: no curve or pool found; position stays STALE`);
		} catch (error) {
			this.log("warn", `${position.symbol}: price source unavailable (${message(error)}); position stays STALE`);
		}
	}

	private onFeed(event: FeedEvent): void {
		if (this.stopped) return;
		if (event.type === "status") {
			this.feedState = { status: event.status, dropped: event.dropped, reconnectAt: event.reconnectAt };
			this.emit({ type: "feed", ...this.feedState });
		} else if (event.type === "launch") {
			this.deps.onRaw?.(event.raw);
			this.addLaunch(event.launch);
			void this.runChecks(event.launch).catch((error) => this.log("error", `Check failed: ${message(error)}`));
		} else if (this.watches.get(event.mint)?.kind === "curve") {
			this.switchToPool(event.mint);
		}
	}

	private addLaunch(launch: Launch): void {
		this.radar.unshift({ launch, check: null });
		if (this.radar.length > RADAR_MAX) this.radar.length = RADAR_MAX;
		this.recentLaunches.push(launch);
		const cutoff = this.deps.clock.now() - DAY_MS;
		if (this.recentLaunches[0].receivedAt < cutoff) {
			this.recentLaunches = this.recentLaunches.filter((entry) => entry.receivedAt >= cutoff);
			const live = new Set(this.recentLaunches.map((entry) => entry.mint));
			for (const mint of this.latestChecks.keys()) if (!live.has(mint)) this.latestChecks.delete(mint);
		}
		this.emit({ type: "launch", launch });
	}

	private async runChecks(launch: Launch): Promise<void> {
		await this.sleepUntil(launch.receivedAt + this.deps.settings.get().snipeDelaySec * 1_000);
		if (this.stopped) return;
		let attempt = 1;
		let check = await this.deps.scout.check(launch, attempt);
		if (this.stopped) return;
		this.recordCheck(check);
		for (const offsetSec of this.deps.settings.get().recheckDelaysSec) {
			if (!this.isSoftRejection(check)) break;
			const at = launch.receivedAt + offsetSec * 1_000;
			if (at <= this.deps.clock.now()) continue;
			await this.sleepUntil(at);
			if (this.stopped) return;
			attempt += 1;
			check = await this.deps.scout.check(launch, attempt);
			if (this.stopped) return;
			this.recordCheck(check);
		}
		if (check.verdict !== "approved") return;
		const decision = this.deps.risk.canOpen("auto", this.closes, this.openCount(), {
			holdConfirmed: false,
			checkVerdict: check.verdict,
		});
		if (!decision.ok) {
			this.log("info", `Skipped ${launch.symbol}: ${decision.reason}`);
			return;
		}
		const placed = this.placeBuy(launch.mint, launch.symbol, "auto");
		if (!placed.ok) this.log("info", `Skipped ${launch.symbol}: ${placed.error}`);
	}

	private isSoftRejection(check: CheckResult): boolean {
		if (check.verdict !== "rejected") return false;
		const failed = check.results.filter((result) => !result.pass);
		return failed.length > 0 && failed.every((result) => !HARD_RULES.includes(result.rule));
	}

	private recordCheck(check: CheckResult): void {
		this.latestChecks.set(check.mint, check);
		const entry = this.radar.find((item) => item.launch.mint === check.mint);
		if (entry) entry.check = check;
		this.emit({ type: "check", check });
	}

	private placeBuy(mint: string, symbol: string, source: OrderUpdate["source"]): Result {
		if (this.positionByMint.has(mint)) return fail("Already holding");
		if (this.pendingBuys.has(mint)) return fail("Order already pending");
		const lamports = solToLamports(this.deps.settings.get().buySol);
		if (lamports > this.balanceLamports()) return fail("Insufficient paper balance");

		const positionId = crypto.randomUUID();
		const order = this.orderFactory(positionId, mint, symbol, "buy", source);
		this.pendingBuys.set(mint, lamports);
		this.emit({ type: "order", order: order("pending") });
		this.trackOrder(async () => {
			const result = await this.deps.executor.buy({ positionId, mint, symbol, solLamports: lamports });
			this.pendingBuys.delete(mint);
			if (!result.ok) {
				this.emit({ type: "order", order: order("failed", result.error) });
				this.emit({ type: "balance", lamports: this.balanceLamports().toString() });
				return;
			}
			const { fill } = result;
			this.deps.ledger.appendFill(fill);
			const position = fromLot({
				positionId,
				mode: fill.mode,
				mint,
				symbol,
				openedAt: fill.ts,
				costLamports: BigInt(fill.solLamports) + BigInt(fill.feesLamports),
				proceedsLamports: 0n,
				tokenAmount: BigInt(fill.tokenAmount),
			});
			this.positions.set(positionId, position);
			this.positionByMint.set(mint, positionId);
			this.emit({ type: "order", order: order("filled") });
			this.emitPosition(position);
			this.emit({ type: "balance", lamports: this.balanceLamports().toString() });
			if (!this.stopped) this.watchCoin(mint);
		});
		return { ok: true };
	}

	private placeSell(positionId: string, pct: 50 | 100, source: OrderUpdate["source"], reason: ExitReason): Result {
		const position = this.positions.get(positionId);
		if (!position) return fail("No open position");
		if (position.pendingOrder) return fail("Order already pending");
		const tokenAmount = pct === 100 ? position.tokenAmount : position.tokenAmount / 2n;
		if (tokenAmount <= 0n) return fail("Nothing to sell");

		const order = this.orderFactory(positionId, position.mint, position.symbol, "sell", source);
		this.setPosition({ ...position, pendingOrder: true });
		this.emit({ type: "order", order: order("pending") });
		this.emitPosition(this.positions.get(positionId) ?? position);
		this.trackOrder(async () => {
			const result = await this.deps.executor.sell({
				positionId,
				mint: position.mint,
				symbol: position.symbol,
				tokenAmount,
			});
			const current = this.positions.get(positionId);
			if (!current) return;
			if (!result.ok) {
				this.setPosition({ ...current, pendingOrder: false });
				this.emit({ type: "order", order: order("failed", result.error) });
				this.emitPosition(this.positions.get(positionId) ?? current);
				return;
			}
			const { fill } = result;
			this.deps.ledger.appendFill(fill);
			this.emit({ type: "order", order: order("filled") });
			const proceeds = current.proceedsLamports + BigInt(fill.solLamports) - BigInt(fill.feesLamports);
			const remaining = current.tokenAmount - tokenAmount;
			if (remaining <= 0n) {
				this.closePosition({ ...current, proceedsLamports: proceeds, tokenAmount: 0n }, reason);
				return;
			}
			let next: PositionState = {
				...current,
				proceedsLamports: proceeds,
				tokenAmount: remaining,
				pendingOrder: false,
			};
			if (current.valueLamports !== null && current.priceSol !== null && current.priceAt !== null) {
				const scaled = (current.valueLamports * remaining) / current.tokenAmount;
				next = revalue(next, scaled, current.priceSol, current.priceAt);
			}
			this.setPosition(next);
			this.emitPosition(next);
			this.emit({ type: "balance", lamports: this.balanceLamports().toString() });
		});
		return { ok: true };
	}

	private closePosition(position: PositionState, reason: ExitReason): void {
		const now = this.deps.clock.now();
		const pnl = position.proceedsLamports - position.costLamports;
		const pnlPct = position.costLamports === 0n ? 0 : (Number(pnl) / Number(position.costLamports)) * 100;
		this.deps.ledger.appendClose({
			positionId: position.id,
			mode: position.mode,
			pnlLamports: pnl.toString(),
			pnlPct,
			reason,
			ts: now,
		});
		const trade: ClosedTrade = {
			positionId: position.id,
			mode: position.mode,
			mint: position.mint,
			symbol: position.symbol,
			costLamports: position.costLamports.toString(),
			proceedsLamports: position.proceedsLamports.toString(),
			pnlLamports: pnl.toString(),
			pnlPct,
			reason,
			openedAt: position.openedAt,
			closedAt: now,
		};
		this.closes.push(trade);
		this.positions.delete(position.id);
		this.positionByMint.delete(position.mint);
		this.lastStale.delete(position.id);
		this.emit({ type: "close", trade });
		this.emitStats();
		this.emitRisk(true);
		this.emit({ type: "balance", lamports: this.balanceLamports().toString() });
		this.unwatchIfIdle(position.mint);
	}

	private watchCoin(mint: string): void {
		if (this.watches.has(mint)) return;
		try {
			const stop = this.deps.chain.watchCurve(mint, (snapshot) => this.onCurve(snapshot));
			this.watches.set(mint, { kind: "curve", stop });
		} catch (error) {
			this.log("warn", `Cannot watch ${mint}: ${message(error)}`);
		}
	}

	private watchPool(mint: string): void {
		if (this.watches.get(mint)?.kind === "pool") return;
		try {
			const stop = this.deps.chain.watchPool(mint, (snapshot) => this.onPool(snapshot));
			this.watches.set(mint, { kind: "pool", stop });
		} catch (error) {
			this.log("warn", `Cannot watch pool for ${mint}: ${message(error)}`);
		}
	}

	private switchToPool(mint: string): void {
		const watch = this.watches.get(mint);
		if (watch?.kind === "pool") return;
		watch?.stop();
		this.watches.delete(mint);
		const id = this.positionByMint.get(mint);
		const position = id ? this.positions.get(id) : undefined;
		if (position) {
			this.setPosition({ ...position, migrated: true });
			this.emitPosition(this.positions.get(position.id) ?? position);
		}
		this.watchPool(mint);
	}

	private unwatchIfIdle(mint: string): void {
		if (this.pinned.has(mint) || this.positionByMint.has(mint)) return;
		this.watches.get(mint)?.stop();
		this.watches.delete(mint);
	}

	private onCurve(snapshot: CurveSnapshot): void {
		if (this.stopped) return;
		if (isMigrated(snapshot)) {
			this.switchToPool(snapshot.mint);
			return;
		}
		const priceSol = curvePriceSol(snapshot.curve);
		this.emit({
			type: "price",
			tick: {
				mint: snapshot.mint,
				priceSol,
				marketCapSol: curveMarketCapSol(snapshot.curve),
				source: "curve",
				at: snapshot.at,
			},
		});
		const position = this.positionFor(snapshot.mint);
		if (!position || !this.loadedGlobals) return;
		const paper = this.deps.settings.get().paper;
		const gross = haircut(
			quoteSellLamports(snapshot, this.loadedGlobals, position.tokenAmount),
			paper.extraSlippageBps,
		);
		this.applyValue(position, gross, priceSol, snapshot.at);
	}

	private onPool(pool: PoolSnapshot): void {
		if (this.stopped) return;
		const priceSol = poolPriceSol(pool);
		const decimals = 10 ** pool.quote.baseMintAccount.decimals;
		this.emit({
			type: "price",
			tick: {
				mint: pool.mint,
				priceSol,
				marketCapSol: priceSol * (Number(pool.quote.baseMintAccount.supply) / decimals),
				source: "pool",
				at: pool.at,
			},
		});
		const position = this.positionFor(pool.mint);
		if (!position) return;
		const paper = this.deps.settings.get().paper;
		const gross = haircut(quotePoolSellLamports(pool, position.tokenAmount), paper.extraSlippageBps);
		this.applyValue(position, gross, priceSol, pool.at);
	}

	// Value is what a sell would net now: haircut quote minus the base and priority fees.
	private applyValue(position: PositionState, grossLamports: bigint, priceSol: number, at: number): void {
		const fees = BASE_FEE_LAMPORTS + solToLamports(this.deps.settings.get().paper.priorityFeeSol);
		const net = grossLamports > fees ? grossLamports - fees : 0n;
		const next = revalue(position, net, priceSol, at);
		this.setPosition(next);
		this.emitPosition(next);
		this.maybeExit(next);
	}

	private maybeExit(position: PositionState): void {
		const reason = evaluateExit(position, this.deps.clock.now(), this.deps.settings.get());
		if (reason) this.placeSell(position.id, 100, "exit", reason);
	}

	private tick(): void {
		if (this.stopped) return;
		const now = this.deps.clock.now();
		if (!this.loadedGlobals && now >= this.nextGlobalsAttempt) {
			this.nextGlobalsAttempt = now + GLOBALS_RETRY_MS;
			void this.loadGlobals();
		}
		const settings = this.deps.settings.get();
		for (const position of [...this.positions.values()]) {
			const stale = isStale(position, now, settings);
			if (this.lastStale.get(position.id) !== stale) {
				this.lastStale.set(position.id, stale);
				this.emitPosition(position);
			}
			this.maybeExit(position);
		}
		this.emitRisk(false);
	}

	private positionFor(mint: string): PositionState | undefined {
		const id = this.positionByMint.get(mint);
		return id ? this.positions.get(id) : undefined;
	}

	private setPosition(position: PositionState): void {
		if (this.positions.has(position.id)) this.positions.set(position.id, position);
	}

	private openCount(): number {
		return this.positions.size + this.pendingBuys.size;
	}

	private balanceLamports(): bigint {
		let balance = solToLamports(this.deps.settings.get().paper.startingBalanceSol);
		for (const trade of this.closes) balance += BigInt(trade.pnlLamports);
		for (const position of this.positions.values()) balance -= position.costLamports - position.proceedsLamports;
		for (const pending of this.pendingBuys.values()) balance -= pending;
		return balance;
	}

	private symbolFor(mint: string): string {
		return this.radar.find((entry) => entry.launch.mint === mint)?.launch.symbol ?? mint.slice(0, 4).toUpperCase();
	}

	private orderFactory(
		positionId: string,
		mint: string,
		symbol: string,
		side: Side,
		source: OrderUpdate["source"],
	): (status: OrderUpdate["status"], error?: string) => OrderUpdate {
		const id = crypto.randomUUID();
		return (status, error) => ({
			id,
			positionId,
			mint,
			symbol,
			side,
			status,
			source,
			...(error === undefined ? {} : { error }),
			at: this.deps.clock.now(),
		});
	}

	private trackOrder(run: () => Promise<void>): void {
		const promise = run().catch((error) => this.log("error", `Order handling failed: ${message(error)}`));
		this.orders.add(promise);
		void promise.finally(() => this.orders.delete(promise));
	}

	private async sleepUntil(at: number): Promise<void> {
		const delay = at - this.deps.clock.now();
		if (delay > 0) await this.deps.clock.sleep(delay);
	}

	private emitPosition(position: PositionState): void {
		const view = toView(position, this.deps.clock.now(), this.deps.settings.get());
		this.lastStale.set(position.id, view.stale);
		this.emit({ type: "position", position: view });
	}

	private emitStats(): void {
		this.emit({
			type: "stats",
			stats: computeStats(this.closes, this.deps.tzOffsetMin()),
			launchStats: computeLaunchStats(this.recentLaunches, [...this.latestChecks.values()], this.deps.clock.now()),
		});
	}

	private emitRisk(force: boolean): void {
		const risk = this.deps.risk.state(this.closes);
		const json = JSON.stringify(risk);
		if (!force && json === this.lastRiskJson) return;
		this.lastRiskJson = json;
		this.emit({ type: "risk", risk });
	}

	private log(level: LogLine["level"], text: string): void {
		this.emit({ type: "log", line: { level, message: text, at: this.deps.clock.now() } });
	}

	private emit(event: EngineEvent): void {
		this.deps.bus.emit(event);
	}
}
