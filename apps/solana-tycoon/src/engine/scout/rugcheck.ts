import type { BondingCurve } from "@pump-fun/pump-sdk";
import type { Settings } from "../../shared/settings";
import type { Launch, RuleId, RuleResult } from "../../shared/types";
import { pump, splToken, web3 } from "../chain/solana";
import type { HolderSummary } from "../chain/types";

export interface RugInput {
	launch: Launch;
	curve: BondingCurve;
	holders: HolderSummary | null;
	creatorLaunchesInWindow: number;
}

export const HARD_RULES: readonly RuleId[] = ["quote_sol", "not_mayhem", "curve_live", "blocklist", "serial_launcher"];

const HOLDERS_UNAVAILABLE = "Holder data unavailable";

const rule = (id: RuleId, pass: boolean, reason: string): RuleResult => ({ rule: id, pass, reason });

function blockedWord(launch: Launch, blocklist: readonly string[]): string | null {
	const haystack = `${launch.name} ${launch.symbol}`.toLowerCase();
	return blocklist.find((word) => word.trim() !== "" && haystack.includes(word.trim().toLowerCase())) ?? null;
}

function topHolderPct(holders: HolderSummary): number {
	if (holders.supply === 0n) return 0;
	const top = holders.holders.reduce((max, holder) => (holder.amount > max ? holder.amount : max), 0n);
	return (Number(top) / Number(holders.supply)) * 100;
}

export function evaluateRules(input: RugInput, rug: Settings["rug"]): RuleResult[] {
	const { curve, holders } = input;
	const quoteIsSol = curve.quoteMint.equals(web3.PublicKey.default) || curve.quoteMint.equals(splToken.NATIVE_MINT);
	const live = !curve.complete && !pump.isBondingCurveMigrated(curve);
	const word = blockedWord(input.launch, rug.blocklist);
	const launches = input.creatorLaunchesInWindow;
	const window = rug.serialWindowMin;
	const realSol = Number(curve.realQuoteReserves.toString()) / 1e9;

	const results: RuleResult[] = [
		rule("quote_sol", quoteIsSol, quoteIsSol ? "Priced in SOL" : "Not priced in SOL"),
		rule("not_mayhem", !curve.isMayhemMode, curve.isMayhemMode ? "Mayhem-mode coin" : "Normal curve"),
		rule("curve_live", live, live ? "Curve live" : "Curve complete or migrated"),
		rule("blocklist", word === null, word === null ? "Name clean" : `Name contains "${word}"`),
		launches < rug.serialLaunchMax
			? rule("serial_launcher", true, `Creator launched ${launches} in ${window}m`)
			: rule("serial_launcher", false, `Serial launcher: ${launches} coins in ${window}m`),
	];

	if (holders === null) {
		results.push(rule("top_holder", false, HOLDERS_UNAVAILABLE), rule("holder_spread", false, HOLDERS_UNAVAILABLE));
	} else {
		const top = topHolderPct(holders);
		const nonEmpty = holders.holders.filter((holder) => holder.amount > 0n).length;
		results.push(
			rule("top_holder", top <= rug.maxTopHolderPct, `Top holder ${top.toFixed(1)}% (max ${rug.maxTopHolderPct}%)`),
			rule(
				"holder_spread",
				nonEmpty >= rug.minHoldersInTop20,
				`${nonEmpty} holders in top 20 (min ${rug.minHoldersInTop20})`,
			),
		);
	}

	results.push(
		rule("min_real_sol", realSol >= rug.minRealSol, `${realSol.toFixed(2)} SOL in curve (min ${rug.minRealSol})`),
	);
	return results;
}
