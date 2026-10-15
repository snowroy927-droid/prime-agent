import type { Settings } from "../../shared/settings";
import type { Fill, Mode, Side } from "../../shared/types";
import { BASE_FEE_LAMPORTS, haircut, solToLamports, TOKEN_ACCOUNT_RENT_LAMPORTS } from "../../shared/units";
import { pump } from "../chain/solana";
import type { ChainSource, Globals } from "../chain/types";
import type { Clock } from "../clock";
import type { BuyRequest, Executor, FillResult, SellRequest } from "./executor";
import { quoteBuyTokens, quotePoolSellLamports, quoteSellLamports } from "./quote";

export interface PaperExecutorDeps {
	mode: Mode;
	chain: ChainSource;
	globals: () => Globals;
	clock: Clock;
	settings: () => Settings;
}

const fail = (error: string): FillResult => ({ ok: false, error });

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Simulates fills against live curve or pool state: real quote math, a latency delay, a slippage
// haircut, and the fees a real transaction would pay.
export class PaperExecutor implements Executor {
	readonly mode: Mode;

	constructor(private readonly deps: PaperExecutorDeps) {
		this.mode = deps.mode;
	}

	async buy(request: BuyRequest): Promise<FillResult> {
		const paper = this.deps.settings().paper;
		await this.deps.clock.sleep(paper.latencyMs);
		try {
			const snapshot = await this.deps.chain.fetchCurve(request.mint);
			if (!snapshot) return fail("Curve not found");
			if (snapshot.curve.complete || pump.isBondingCurveMigrated(snapshot.curve)) {
				return fail("Coin migrated before fill");
			}
			const quoted = quoteBuyTokens(snapshot, this.deps.globals(), request.solLamports);
			// The SDK clamps quotes to realTokenReserves, so reaching it means the buy would drain the curve.
			if (quoted >= BigInt(snapshot.curve.realTokenReserves.toString())) {
				return fail("Buy exceeds remaining curve supply");
			}
			const fees = BASE_FEE_LAMPORTS + solToLamports(paper.priorityFeeSol) + TOKEN_ACCOUNT_RENT_LAMPORTS;
			return this.filled(request, "buy", request.solLamports, haircut(quoted, paper.extraSlippageBps), fees);
		} catch (error) {
			return fail(errorMessage(error));
		}
	}

	async sell(request: SellRequest): Promise<FillResult> {
		const paper = this.deps.settings().paper;
		await this.deps.clock.sleep(paper.latencyMs);
		try {
			const snapshot = await this.deps.chain.fetchCurve(request.mint);
			let proceeds: bigint;
			if (snapshot && !snapshot.curve.complete && !pump.isBondingCurveMigrated(snapshot.curve)) {
				proceeds = quoteSellLamports(snapshot, this.deps.globals(), request.tokenAmount);
			} else {
				const pool = await this.deps.chain.fetchPool(request.mint);
				if (!pool) return fail("No price source");
				proceeds = quotePoolSellLamports(pool, request.tokenAmount);
			}
			const fees = BASE_FEE_LAMPORTS + solToLamports(paper.priorityFeeSol);
			return this.filled(request, "sell", haircut(proceeds, paper.extraSlippageBps), request.tokenAmount, fees);
		} catch (error) {
			return fail(errorMessage(error));
		}
	}

	private filled(
		request: BuyRequest | SellRequest,
		side: Side,
		solLamports: bigint,
		tokenAmount: bigint,
		feesLamports: bigint,
	): FillResult {
		const fill: Fill = {
			id: crypto.randomUUID(),
			positionId: request.positionId,
			mode: this.mode,
			mint: request.mint,
			symbol: request.symbol,
			side,
			solLamports: solLamports.toString(),
			tokenAmount: tokenAmount.toString(),
			feesLamports: feesLamports.toString(),
			ts: this.deps.clock.now(),
		};
		return { ok: true, fill };
	}
}
