import type { Settings } from "../../shared/settings";
import type { CheckResult, Launch, RuleResult, Verdict } from "../../shared/types";
import type { RpcBudget } from "../chain/rpcBudget";
import type { ChainSource, HolderSummary } from "../chain/types";
import type { Clock } from "../clock";
import type { LaunchHistory } from "./launchHistory";
import { evaluateRules } from "./rugcheck";

export interface ScoutDeps {
	chain: ChainSource;
	budget: RpcBudget;
	history: LaunchHistory;
	clock: Clock;
	settings: () => Settings;
}

// A check makes three RPC calls: curve plus mint, largest accounts, and supply.
const CHECK_COST = 3;

export class Scout {
	constructor(private readonly deps: ScoutDeps) {}

	async check(launch: Launch, attempt: number): Promise<CheckResult> {
		const done = (verdict: Verdict, reason: string, results: RuleResult[] = []): CheckResult => ({
			mint: launch.mint,
			verdict,
			results,
			reason,
			checkedAt: this.deps.clock.now(),
			attempt,
		});

		if (!this.deps.budget.canAfford(CHECK_COST)) return done("unchecked", "RPC budget exhausted");

		let curveSnapshot: Awaited<ReturnType<ChainSource["fetchCurve"]>>;
		try {
			curveSnapshot = await this.deps.chain.fetchCurve(launch.mint);
		} catch (error) {
			return done("unchecked", `RPC error: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!curveSnapshot) return done("rejected", "Curve not found");

		let holders: HolderSummary | null = null;
		try {
			holders = await this.deps.chain.fetchHolders(launch.mint, curveSnapshot.tokenProgram);
		} catch {
			holders = null;
		}

		const settings = this.deps.settings();
		const creator = launch.creator ?? curveSnapshot.curve.creator.toBase58();
		this.deps.history.record(creator, launch.mint, launch.receivedAt);
		const creatorLaunchesInWindow = this.deps.history.countInWindow(
			creator,
			settings.rug.serialWindowMin * 60_000,
			Math.max(this.deps.clock.now(), launch.receivedAt),
		);

		const results = evaluateRules(
			{ launch, curve: curveSnapshot.curve, holders, creatorLaunchesInWindow },
			settings.rug,
		);
		const failed = results.find((result) => !result.pass);
		return done(failed ? "rejected" : "approved", failed ? failed.reason : "All checks passed", results);
	}
}
