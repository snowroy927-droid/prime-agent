import { formatUsdShort, type KrakenSettings, type RuleStatus } from "../../shared/kraken";

export interface RuleInput {
	change5m: number | null;
	change15m: number | null;
	volumeUsd24h: number;
	spreadPct: number;
	usdVolume15m: number;
	usdVolume60m: number;
	minutesCovered: number;
	held: boolean;
	cooldownUntil: number | null;
	now: number;
	tzOffsetMin: number;
}

const WARM_UP_MIN = 15;

const num = (value: number): string => String(Number(value.toFixed(2)));

function localClock(at: number, tzOffsetMin: number): string {
	const local = new Date(at + tzOffsetMin * 60_000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

// Spec Section 5: conditions in order, the first failure wins.
export function evaluateRule(input: RuleInput, s: KrakenSettings): { status: RuleStatus; reason: string } {
	if (input.minutesCovered < WARM_UP_MIN || input.change15m === null) {
		return { status: "warming_up", reason: `Warming up (${Math.min(input.minutesCovered, WARM_UP_MIN)} of 15 min)` };
	}
	if (input.volumeUsd24h < s.scan.minVolumeUsd24h) {
		return {
			status: "low_volume",
			reason: `Volume ${formatUsdShort(input.volumeUsd24h)} < ${formatUsdShort(s.scan.minVolumeUsd24h)}`,
		};
	}
	if (input.spreadPct > s.scan.maxSpreadPct) {
		return { status: "wide_spread", reason: `Spread ${num(input.spreadPct)}% > ${num(s.scan.maxSpreadPct)}%` };
	}
	if (input.change15m < s.rule.minChange15mPct) {
		const direction = input.change15m >= 0 ? "Up" : "Down";
		return {
			status: "small_move",
			reason: `${direction} ${num(Math.abs(input.change15m))}% in 15m (needs ${num(s.rule.minChange15mPct)}%)`,
		};
	}
	if (s.rule.requireRising5m && !(input.change5m !== null && input.change5m > 0)) {
		return { status: "not_rising", reason: "Falling over 5m" };
	}
	// The pace per 15 minutes over the history actually held (up to an hour), so a pair with only a few minutes of
	// live bars cannot pass by comparing its last 15 minutes with themselves.
	const window = Math.min(60, Math.max(WARM_UP_MIN, input.minutesCovered));
	const hourlyPace = (input.usdVolume60m * 15) / window;
	if (input.usdVolume15m < s.rule.volumeSurge * hourlyPace) {
		const ratio = hourlyPace > 0 ? input.usdVolume15m / hourlyPace : 0;
		return {
			status: "no_volume_surge",
			reason: `Volume ${ratio.toFixed(1)}x hourly pace (needs ${num(s.rule.volumeSurge)}x)`,
		};
	}
	if (input.held) return { status: "held", reason: "Already held" };
	if (input.cooldownUntil !== null && input.cooldownUntil > input.now) {
		return { status: "cooldown", reason: `Cooldown until ${localClock(input.cooldownUntil, input.tzOffsetMin)}` };
	}
	return { status: "eligible", reason: "All rule checks passed" };
}
