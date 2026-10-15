import type { BondingCurve, FeeConfig, Global } from "@pump-fun/pump-sdk";
import type { FeeConfig as AmmFeeConfig, GlobalConfig } from "@pump-fun/pump-swap-sdk";
import type { RawMint } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";

export interface Globals {
	global: Global;
	feeConfig: FeeConfig | null;
}

export type TokenProgramKind = "spl" | "token2022";

export interface CurveSnapshot {
	mint: string;
	curve: BondingCurve;
	tokenProgram: TokenProgramKind;
	slot: number;
	at: number;
}

export interface HolderSummary {
	supply: bigint;
	curveAccount: string;
	holders: { account: string; amount: bigint }[];
}

export interface PoolQuoteInputs {
	globalConfig: GlobalConfig;
	feeConfig: AmmFeeConfig | null;
	baseMintAccount: RawMint;
	baseMint: PublicKey;
	coinCreator: PublicKey;
	creator: PublicKey;
	quoteMint: PublicKey;
	isMayhemMode: boolean;
	creatorFeeBps: BN;
}

export interface PoolSnapshot {
	mint: string;
	baseReserve: bigint;
	quoteReserve: bigint;
	slot: number;
	at: number;
	quote: PoolQuoteInputs;
}

export interface ChainSource {
	fetchGlobals(): Promise<Globals>;
	fetchCurve(mint: string): Promise<CurveSnapshot | null>;
	watchCurve(mint: string, onUpdate: (snapshot: CurveSnapshot) => void): () => void;
	fetchHolders(mint: string, tokenProgram: TokenProgramKind): Promise<HolderSummary>;
	fetchPool(mint: string): Promise<PoolSnapshot | null>;
	watchPool(mint: string, onUpdate: (snapshot: PoolSnapshot) => void): () => void;
	health(): { degraded: boolean };
}

export type ChainConnection = Pick<
	Connection,
	| "getMultipleAccountsInfo"
	| "getMultipleAccountsInfoAndContext"
	| "getAccountInfo"
	| "onAccountChange"
	| "removeAccountChangeListener"
	| "getTokenLargestAccounts"
	| "getTokenSupply"
>;

export class WatchLimitError extends Error {
	constructor(limit: number) {
		super(`At most ${limit} curves and pools can be watched at once`);
		this.name = "WatchLimitError";
	}
}
