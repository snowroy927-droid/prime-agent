import type { Fill, Mode } from "../../shared/types";

export interface BuyRequest {
	positionId: string;
	mint: string;
	symbol: string;
	solLamports: bigint;
}

export interface SellRequest {
	positionId: string;
	mint: string;
	symbol: string;
	tokenAmount: bigint;
}

export type FillResult = { ok: true; fill: Fill } | { ok: false; error: string };

export interface Executor {
	readonly mode: Mode;
	buy(request: BuyRequest): Promise<FillResult>;
	sell(request: SellRequest): Promise<FillResult>;
}
