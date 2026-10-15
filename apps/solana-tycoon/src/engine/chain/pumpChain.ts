import type { FeeConfig as AmmFeeConfig, GlobalConfig } from "@pump-fun/pump-swap-sdk";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import type { Clock } from "../clock";
import { decodeMint, decodePool, tokenAccountAmount } from "./pumpPool";
import type { RpcBudget } from "./rpcBudget";
import { pump, splToken, swap, web3 } from "./solana";
import {
	type ChainConnection,
	type ChainSource,
	type CurveSnapshot,
	type Globals,
	type HolderSummary,
	MAX_WATCHES,
	type PoolQuoteInputs,
	type PoolSnapshot,
	type TokenProgramKind,
	WatchLimitError,
} from "./types";

const POLL_MS = 2_000;
const DEGRADED_AFTER_ERRORS = 3;
const BUDGET_RETRY_MS = 100;

interface CurveWatch {
	kind: "curve";
	mint: string;
	account: PublicKey;
	lastSlot: number;
	subscriptionId: number;
	onUpdate: (snapshot: CurveSnapshot) => void;
}

interface PoolWatch {
	kind: "pool";
	mint: string;
	lastSlot: number;
	accounts: { base: PublicKey; quote: PublicKey; inputs: PoolQuoteInputs } | null;
	loading: boolean;
	onUpdate: (snapshot: PoolSnapshot) => void;
}

type Watch = CurveWatch | PoolWatch;

export class PumpChain implements ChainSource {
	private readonly watches = new Map<number, Watch>();
	private readonly tokenPrograms = new Map<string, TokenProgramKind>();
	private nextWatchId = 1;
	private stopPoll: (() => void) | null = null;
	private polling = false;
	private consecutiveErrors = 0;
	private ammConfigs: { globalConfig: GlobalConfig; feeConfig: AmmFeeConfig | null } | null = null;

	constructor(
		private readonly conn: ChainConnection,
		private readonly budget: RpcBudget,
		private readonly clock: Clock,
	) {}

	health(): { degraded: boolean } {
		return { degraded: this.consecutiveErrors >= DEGRADED_AFTER_ERRORS };
	}

	async fetchGlobals(): Promise<Globals> {
		const { value } = await this.call(1, () =>
			this.conn.getMultipleAccountsInfoAndContext([pump.GLOBAL_PDA, pump.PUMP_FEE_CONFIG_PDA]),
		);
		const [globalInfo, feeInfo] = value;
		if (!globalInfo) throw new Error("pump Global account not found");
		return {
			global: pump.PUMP_SDK.decodeGlobal(globalInfo),
			feeConfig: feeInfo ? pump.PUMP_SDK.decodeFeeConfig(feeInfo) : null,
		};
	}

	async fetchCurve(mint: string): Promise<CurveSnapshot | null> {
		const mintKey = new web3.PublicKey(mint);
		const { context, value } = await this.call(1, () =>
			this.conn.getMultipleAccountsInfoAndContext([pump.bondingCurvePda(mintKey), mintKey]),
		);
		const [curveInfo, mintInfo] = value;
		if (!curveInfo) return null;
		const tokenProgram: TokenProgramKind = mintInfo?.owner.equals(splToken.TOKEN_2022_PROGRAM_ID)
			? "token2022"
			: "spl";
		this.tokenPrograms.set(mint, tokenProgram);
		return {
			mint,
			curve: pump.PUMP_SDK.decodeBondingCurve(curveInfo),
			tokenProgram,
			slot: context.slot,
			at: this.clock.now(),
		};
	}

	watchCurve(mint: string, onUpdate: (snapshot: CurveSnapshot) => void): () => void {
		this.assertWatchCapacity();
		const account = pump.bondingCurvePda(new web3.PublicKey(mint));
		const id = this.nextWatchId++;
		const watch: CurveWatch = { kind: "curve", mint, account, lastSlot: -1, subscriptionId: -1, onUpdate };
		watch.subscriptionId = this.conn.onAccountChange(account, (info, context) =>
			this.deliverCurve(watch, info, context.slot),
		);
		this.watches.set(id, watch);
		this.ensurePolling();
		return () => this.unwatch(id);
	}

	async fetchHolders(mint: string, tokenProgram: TokenProgramKind): Promise<HolderSummary> {
		const mintKey = new web3.PublicKey(mint);
		const programId = tokenProgram === "token2022" ? splToken.TOKEN_2022_PROGRAM_ID : splToken.TOKEN_PROGRAM_ID;
		const curveAccount = splToken.getAssociatedTokenAddressSync(
			mintKey,
			pump.bondingCurvePda(mintKey),
			true,
			programId,
		);
		const [largest, supply] = await this.call(2, () =>
			Promise.all([this.conn.getTokenLargestAccounts(mintKey), this.conn.getTokenSupply(mintKey)]),
		);
		return {
			supply: BigInt(supply.value.amount),
			curveAccount: curveAccount.toBase58(),
			holders: largest.value
				.filter((entry) => !entry.address.equals(curveAccount))
				.map((entry) => ({ account: entry.address.toBase58(), amount: BigInt(entry.amount) })),
		};
	}

	async fetchPool(mint: string): Promise<PoolSnapshot | null> {
		return (await this.readPool(mint))?.snapshot ?? null;
	}

	private async readPool(mint: string): Promise<{ snapshot: PoolSnapshot; base: PublicKey; quote: PublicKey } | null> {
		const mintKey = new web3.PublicKey(mint);
		const first = await this.call(1, () =>
			this.conn.getMultipleAccountsInfoAndContext([swap.canonicalPumpPoolPda(mintKey), mintKey]),
		);
		const [poolInfo, mintInfo] = first.value;
		if (!poolInfo) return null;
		if (!mintInfo) throw new Error(`mint account ${mint} not found`);
		const pool = decodePool(poolInfo);

		const configKeys = this.ammConfigs ? [] : [swap.GLOBAL_CONFIG_PDA, swap.PUMP_AMM_FEE_CONFIG_PDA];
		const second = await this.call(1, () =>
			this.conn.getMultipleAccountsInfoAndContext([
				pool.poolBaseTokenAccount,
				pool.poolQuoteTokenAccount,
				...configKeys,
			]),
		);
		const [baseInfo, quoteInfo, globalConfigInfo, feeConfigInfo] = second.value;
		if (!baseInfo || !quoteInfo) throw new Error(`pool token accounts for ${mint} not found`);
		if (!this.ammConfigs) {
			if (!globalConfigInfo) throw new Error("pump-amm GlobalConfig account not found");
			this.ammConfigs = {
				globalConfig: swap.PUMP_AMM_SDK.decodeGlobalConfig(globalConfigInfo),
				feeConfig: feeConfigInfo ? swap.PUMP_AMM_SDK.decodeFeeConfig(feeConfigInfo) : null,
			};
		}
		const snapshot: PoolSnapshot = {
			mint,
			baseReserve: tokenAccountAmount(baseInfo),
			quoteReserve: tokenAccountAmount(quoteInfo),
			slot: second.context.slot,
			at: this.clock.now(),
			quote: {
				...this.ammConfigs,
				baseMintAccount: decodeMint(mintInfo),
				baseMint: pool.baseMint,
				coinCreator: pool.coinCreator,
				creator: pool.creator,
				quoteMint: pool.quoteMint,
				isMayhemMode: pool.isMayhemMode,
				creatorFeeBps: pool.creatorFeeBps,
			},
		};
		return { snapshot, base: pool.poolBaseTokenAccount, quote: pool.poolQuoteTokenAccount };
	}

	// Pools have no websocket subscription; the shared 2s batched poll reads their token accounts.
	watchPool(mint: string, onUpdate: (snapshot: PoolSnapshot) => void): () => void {
		this.assertWatchCapacity();
		const id = this.nextWatchId++;
		const watch: PoolWatch = { kind: "pool", mint, lastSlot: -1, accounts: null, loading: false, onUpdate };
		this.watches.set(id, watch);
		this.loadPool(watch);
		this.ensurePolling();
		return () => this.unwatch(id);
	}

	private assertWatchCapacity(): void {
		if (this.watches.size >= MAX_WATCHES) throw new WatchLimitError(MAX_WATCHES);
	}

	private unwatch(id: number): void {
		const watch = this.watches.get(id);
		if (!watch) return;
		this.watches.delete(id);
		if (watch.kind === "curve") void this.conn.removeAccountChangeListener(watch.subscriptionId).catch(() => {});
		if (this.watches.size === 0) {
			this.stopPoll?.();
			this.stopPoll = null;
		}
	}

	private loadPool(watch: PoolWatch): void {
		if (watch.loading) return;
		watch.loading = true;
		this.readPool(watch.mint)
			.then((read) => {
				if (!read) return;
				watch.accounts = { base: read.base, quote: read.quote, inputs: read.snapshot.quote };
				this.deliverPool(watch, read.snapshot);
			})
			.catch(() => {})
			.finally(() => {
				watch.loading = false;
			});
	}

	private deliverCurve(watch: CurveWatch, info: AccountInfo<Buffer>, slot: number): void {
		if (slot <= watch.lastSlot) return;
		let curve: CurveSnapshot["curve"];
		try {
			curve = pump.PUMP_SDK.decodeBondingCurve(info);
		} catch {
			return;
		}
		watch.lastSlot = slot;
		watch.onUpdate({
			mint: watch.mint,
			curve,
			tokenProgram: this.tokenPrograms.get(watch.mint) ?? "spl",
			slot,
			at: this.clock.now(),
		});
	}

	private deliverPool(watch: PoolWatch, snapshot: PoolSnapshot): void {
		if (snapshot.slot <= watch.lastSlot) return;
		watch.lastSlot = snapshot.slot;
		watch.onUpdate(snapshot);
	}

	private ensurePolling(): void {
		if (this.stopPoll) return;
		this.stopPoll = this.clock.every(POLL_MS, () => {
			void this.poll();
		});
	}

	private async poll(): Promise<void> {
		if (this.polling) return;
		const watches = [...this.watches.values()];
		const keys: PublicKey[] = [];
		const readers: ((value: (AccountInfo<Buffer> | null)[], slot: number) => void)[] = [];
		for (const watch of watches) {
			if (watch.kind === "curve") {
				const index = keys.push(watch.account) - 1;
				readers.push((value, slot) => {
					const info = value[index];
					if (info) this.deliverCurve(watch, info, slot);
				});
			} else if (watch.accounts) {
				const accounts = watch.accounts;
				const baseIndex = keys.push(accounts.base) - 1;
				const quoteIndex = keys.push(accounts.quote) - 1;
				readers.push((value, slot) => {
					const base = value[baseIndex];
					const quote = value[quoteIndex];
					if (!base || !quote) return;
					this.deliverPool(watch, {
						mint: watch.mint,
						baseReserve: tokenAccountAmount(base),
						quoteReserve: tokenAccountAmount(quote),
						slot,
						at: this.clock.now(),
						quote: accounts.inputs,
					});
				});
			} else {
				this.loadPool(watch);
			}
		}
		if (keys.length === 0 || !this.budget.tryTake(1)) return;
		this.polling = true;
		try {
			const { context, value } = await this.conn.getMultipleAccountsInfoAndContext(keys);
			this.consecutiveErrors = 0;
			for (const read of readers) read(value, context.slot);
		} catch {
			this.consecutiveErrors += 1;
		} finally {
			this.polling = false;
		}
	}

	private async call<T>(cost: number, fn: () => Promise<T>): Promise<T> {
		const needed = Math.min(cost, this.budget.capacity());
		while (!this.budget.tryTake(needed)) await this.clock.sleep(BUDGET_RETRY_MS);
		try {
			const result = await fn();
			this.consecutiveErrors = 0;
			return result;
		} catch (error) {
			this.consecutiveErrors += 1;
			throw error;
		}
	}
}
