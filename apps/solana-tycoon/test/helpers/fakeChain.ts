import type { BondingCurve } from "@pump-fun/pump-sdk";
import type { RpcBudget } from "../../src/engine/chain/rpcBudget";
import type {
	ChainSource,
	CurveSnapshot,
	Globals,
	HolderSummary,
	PoolSnapshot,
	TokenProgramKind,
} from "../../src/engine/chain/types";
import type { Clock } from "../../src/engine/clock";
import { fixtureGlobal } from "./curves";

type Listener<T> = (snapshot: T) => void;

export class FakeChain implements ChainSource {
	globals: Globals = { global: fixtureGlobal(), feeConfig: null };
	degraded = false;
	fetchCurveError: Error | null = null;
	private slot = 1;
	private readonly curves = new Map<string, CurveSnapshot>();
	private readonly pools = new Map<string, PoolSnapshot>();
	private readonly holders = new Map<string, HolderSummary>();
	private readonly curveListeners = new Map<string, Set<Listener<CurveSnapshot>>>();
	private readonly poolListeners = new Map<string, Set<Listener<PoolSnapshot>>>();

	// With a budget, reads spend it like PumpChain does (curve 1, holders 2, pool 2).
	constructor(
		private readonly clock: Clock,
		private readonly budget: RpcBudget | null = null,
	) {}

	setCurve(mint: string, curve: BondingCurve | null, tokenProgram: TokenProgramKind = "spl"): void {
		if (!curve) {
			this.curves.delete(mint);
			return;
		}
		const snapshot: CurveSnapshot = { mint, curve, tokenProgram, slot: ++this.slot, at: this.clock.now() };
		this.curves.set(mint, snapshot);
		for (const listener of this.curveListeners.get(mint) ?? []) listener(snapshot);
	}

	setPool(mint: string, pool: PoolSnapshot | null): void {
		if (!pool) {
			this.pools.delete(mint);
			return;
		}
		const snapshot = { ...pool, slot: ++this.slot, at: this.clock.now() };
		this.pools.set(mint, snapshot);
		for (const listener of this.poolListeners.get(mint) ?? []) listener(snapshot);
	}

	setHolders(mint: string, summary: HolderSummary): void {
		this.holders.set(mint, summary);
	}

	watchCount(): number {
		let count = 0;
		for (const set of [...this.curveListeners.values(), ...this.poolListeners.values()]) count += set.size;
		return count;
	}

	async fetchGlobals(): Promise<Globals> {
		return this.globals;
	}

	async fetchCurve(mint: string): Promise<CurveSnapshot | null> {
		if (this.fetchCurveError) throw this.fetchCurveError;
		this.budget?.tryTake(1);
		return this.curves.get(mint) ?? null;
	}

	watchCurve(mint: string, onUpdate: Listener<CurveSnapshot>): () => void {
		return this.listen(this.curveListeners, mint, onUpdate);
	}

	async fetchHolders(mint: string): Promise<HolderSummary> {
		this.budget?.tryTake(2);
		return this.holders.get(mint) ?? { supply: 1_000_000_000_000_000n, curveAccount: "curve", holders: [] };
	}

	async fetchPool(mint: string): Promise<PoolSnapshot | null> {
		this.budget?.tryTake(2);
		return this.pools.get(mint) ?? null;
	}

	watchPool(mint: string, onUpdate: Listener<PoolSnapshot>): () => void {
		return this.listen(this.poolListeners, mint, onUpdate);
	}

	health(): { degraded: boolean } {
		return { degraded: this.degraded };
	}

	private listen<T>(map: Map<string, Set<Listener<T>>>, mint: string, listener: Listener<T>): () => void {
		const set = map.get(mint) ?? new Set<Listener<T>>();
		set.add(listener);
		map.set(mint, set);
		return () => {
			set.delete(listener);
		};
	}
}
