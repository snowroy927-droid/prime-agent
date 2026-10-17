export type FieldKind = "number" | "numberList" | "textList" | "boolean";

export interface Field {
	path: string;
	label: string;
	kind: FieldKind;
	hint: string;
}

export interface Section {
	title: string;
	fields: Field[];
}

export const PUMP_SECTIONS: Section[] = [
	{
		title: "TRADING",
		fields: [
			{ path: "buySol", label: "BUY SIZE (SOL)", kind: "number", hint: "Max 1 SOL" },
			{ path: "maxPositions", label: "MAX POSITIONS", kind: "number", hint: "Max 10" },
			{ path: "takeProfitPct", label: "TAKE PROFIT %", kind: "number", hint: "Sell all at this gain" },
			{ path: "stopLossPct", label: "STOP LOSS %", kind: "number", hint: "Sell all at this loss" },
			{ path: "trailingStopPct", label: "TRAILING STOP %", kind: "number", hint: "0 turns it off" },
			{ path: "maxHoldMin", label: "MAX HOLD (MIN)", kind: "number", hint: "Sell after this long" },
			{
				path: "dailyLossCapSol",
				label: "DAILY LOSS CAP (SOL)",
				kind: "number",
				hint: "Auto-snipe stops until midnight",
			},
			{ path: "tiltLosses", label: "TILT AFTER LOSSES", kind: "number", hint: "Consecutive losing closes" },
			{ path: "tiltCooldownMin", label: "TILT COOLDOWN (MIN)", kind: "number", hint: "Auto-snipe pause" },
			{ path: "snipeDelaySec", label: "CHECK DELAY (S)", kind: "number", hint: "Wait before the rug check" },
			{ path: "recheckDelaysSec", label: "RE-CHECKS (S)", kind: "numberList", hint: "Comma separated, from launch" },
			{ path: "priceStaleSec", label: "STALE AFTER (S)", kind: "number", hint: "No auto exits on older prices" },
		],
	},
	{
		title: "RUG CHECK",
		fields: [
			{ path: "rug.blocklist", label: "NAME BLOCKLIST", kind: "textList", hint: "Comma separated words" },
			{
				path: "rug.serialLaunchMax",
				label: "SERIAL LAUNCH MAX",
				kind: "number",
				hint: "Coins per creator in the window",
			},
			{ path: "rug.serialWindowMin", label: "SERIAL WINDOW (MIN)", kind: "number", hint: "Creator history window" },
			{ path: "rug.maxTopHolderPct", label: "MAX TOP HOLDER %", kind: "number", hint: "Excluding the curve" },
			{ path: "rug.minHoldersInTop20", label: "MIN HOLDERS IN TOP 20", kind: "number", hint: "0 to 20" },
			{ path: "rug.minRealSol", label: "MIN REAL SOL", kind: "number", hint: "SOL already in the curve" },
		],
	},
	{
		title: "PAPER FILLS",
		fields: [
			{ path: "paper.startingBalanceSol", label: "STARTING BALANCE (SOL)", kind: "number", hint: "Paper wallet" },
			{ path: "paper.latencyMs", label: "FILL LATENCY (MS)", kind: "number", hint: "Simulated confirmation time" },
			{
				path: "paper.extraSlippageBps",
				label: "EXTRA SLIPPAGE (BPS)",
				kind: "number",
				hint: "Haircut on every fill",
			},
			{ path: "paper.priorityFeeSol", label: "PRIORITY FEE (SOL)", kind: "number", hint: "Per transaction" },
		],
	},
];

// Spec Section 12; autoBuy is the panel's toggle.
export const KRAKEN_SECTIONS: Section[] = [
	{
		title: "TRADING",
		fields: [
			{ path: "buyUsd", label: "BUY SIZE (USD)", kind: "number", hint: "Max $1,000" },
			{ path: "maxPositions", label: "MAX POSITIONS", kind: "number", hint: "Max 10" },
			{ path: "takeProfitPct", label: "TAKE PROFIT %", kind: "number", hint: "Sell all at this gain" },
			{ path: "stopLossPct", label: "STOP LOSS %", kind: "number", hint: "Sell all at this loss" },
			{ path: "trailingStopPct", label: "TRAILING STOP %", kind: "number", hint: "Points below peak PnL %" },
			{ path: "trailingArmPct", label: "TRAILING ARMS AT %", kind: "number", hint: "Peak PnL % that arms it" },
			{ path: "maxHoldMin", label: "MAX HOLD (MIN)", kind: "number", hint: "Sell after this long" },
			{
				path: "dailyLossCapUsd",
				label: "DAILY LOSS CAP (USD)",
				kind: "number",
				hint: "Auto-buy stops until midnight",
			},
			{ path: "tiltLosses", label: "TILT AFTER LOSSES", kind: "number", hint: "Consecutive losing closes" },
			{ path: "tiltCooldownMin", label: "TILT COOLDOWN (MIN)", kind: "number", hint: "Auto-buy pause" },
			{ path: "priceStaleSec", label: "STALE AFTER (S)", kind: "number", hint: "No auto exits on older prices" },
		],
	},
	{
		title: "SCANNER",
		fields: [
			{ path: "scan.minVolumeUsd24h", label: "MIN 24H VOLUME (USD)", kind: "number", hint: "Volume filter" },
			{ path: "scan.maxSpreadPct", label: "MAX SPREAD %", kind: "number", hint: "Wider pairs are skipped" },
			{
				path: "scan.excludeBases",
				label: "EXCLUDED BASES",
				kind: "textList",
				hint: "Comma separated, never scanned",
			},
		],
	},
	{
		title: "MOMENTUM RULE",
		fields: [
			{ path: "rule.minChange15mPct", label: "MIN 15M MOVE %", kind: "number", hint: "Move condition" },
			{
				path: "rule.requireRising5m",
				label: "STILL RISING OVER 5M",
				kind: "boolean",
				hint: "Still-rising condition",
			},
			{ path: "rule.volumeSurge", label: "VOLUME SURGE (X)", kind: "number", hint: "15m volume vs hourly pace" },
			{ path: "rule.reentryCooldownMin", label: "RE-ENTRY COOLDOWN (MIN)", kind: "number", hint: "Per pair" },
		],
	},
	{
		title: "PAPER FILLS",
		fields: [
			{ path: "paper.startingBalanceUsd", label: "STARTING BALANCE (USD)", kind: "number", hint: "Paper wallet" },
			{
				path: "paper.takerFeePct",
				label: "TAKER FEE %",
				kind: "number",
				hint: "Per fill. Set it to your account's tier.",
			},
			{ path: "paper.extraSlippageBps", label: "EXTRA SLIPPAGE (BPS)", kind: "number", hint: "Haircut per fill" },
			{ path: "paper.latencyMs", label: "FILL LATENCY (MS)", kind: "number", hint: "Delay before pricing" },
		],
	},
];
