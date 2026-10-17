import type { Outcome } from "../../shared/outcome";
import type { Settings } from "../../shared/settings";
import { consecutiveLossesOf, tiltUntilOf } from "../../shared/tilt";
import type { RiskState } from "../../shared/types";
import { solToLamports } from "../../shared/units";
import type { Clock } from "../clock";

export type OpenKind = "auto" | "manual";
export type Signal = "approved" | "rejected" | null;

// `dailyLossCap` is in the desk's minor units, like Outcome.pnl.
export interface RiskLimits {
	maxPositions: number;
	auto: boolean;
	dailyLossCap: bigint;
	tiltLosses: number;
	tiltCooldownMin: number;
}

export interface RiskCopy {
	autoOff: string;
	notApproved: string;
	rejectedHold: string;
}

export const PUMP_RISK_COPY: RiskCopy = {
	autoOff: "Auto-snipe off",
	notApproved: "Not approved",
	rejectedHold: "Hold to snipe a rejected coin",
};

export function pumpLimits(s: Settings): RiskLimits {
	return {
		maxPositions: s.maxPositions,
		auto: s.autoSnipe,
		dailyLossCap: solToLamports(s.dailyLossCapSol),
		tiltLosses: s.tiltLosses,
		tiltCooldownMin: s.tiltCooldownMin,
	};
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

// Offsets are local time minus UTC in minutes (-300 for US Central daylight time).
export function defaultTzOffsetMin(): number {
	return -new Date().getTimezoneOffset();
}

function localDayStart(now: number, tzOffsetMin: number): number {
	const offsetMs = tzOffsetMin * MINUTE_MS;
	return Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
}

export function nextLocalMidnight(now: number, tzOffsetMin: number): number {
	return localDayStart(now, tzOffsetMin) + DAY_MS;
}

export function dailyPnl(outcomes: readonly Outcome[], now: number, tzOffsetMin: number): bigint {
	const start = localDayStart(now, tzOffsetMin);
	return outcomes
		.filter((outcome) => outcome.closedAt >= start && outcome.closedAt <= now)
		.reduce((total, outcome) => total + outcome.pnl, 0n);
}

function localClock(at: number, tzOffsetMin: number): string {
	const local = new Date(at + tzOffsetMin * MINUTE_MS);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export interface RiskGuardDeps {
	clock: Clock;
	limits: () => RiskLimits;
	copy: RiskCopy;
	tzOffsetMin?: () => number;
}

export class RiskGuard {
	private paused = false;
	private pausedReason: string | null = null;
	private readonly tzOffsetMin: () => number;

	constructor(private readonly deps: RiskGuardDeps) {
		this.tzOffsetMin = deps.tzOffsetMin ?? defaultTzOffsetMin;
	}

	setPaused(paused: boolean, reason: string | null): void {
		this.paused = paused;
		this.pausedReason = paused ? reason : null;
	}

	state(outcomes: readonly Outcome[]): RiskState {
		const limits = this.deps.limits();
		const daily = this.dailyPnl(outcomes);
		return {
			auto: limits.auto,
			paused: this.paused,
			pausedReason: this.pausedReason,
			tiltLosses: consecutiveLossesOf(outcomes),
			tiltUntil: this.activeTilt(outcomes),
			dailyPnl: daily.toString(),
			dailyCapUntil: this.capHit(daily) ? nextLocalMidnight(this.deps.clock.now(), this.tzOffsetMin()) : null,
		};
	}

	canOpen(
		kind: OpenKind,
		outcomes: readonly Outcome[],
		openCount: number,
		opts: { holdConfirmed: boolean; signal: Signal },
	): { ok: true } | { ok: false; reason: string } {
		const limits = this.deps.limits();
		const copy = this.deps.copy;
		if (this.paused) return { ok: false, reason: "Engine paused" };
		if (openCount >= limits.maxPositions)
			return { ok: false, reason: `Max positions (${limits.maxPositions}) reached` };
		const tilt = this.activeTilt(outcomes);

		if (kind === "auto") {
			if (!limits.auto) return { ok: false, reason: copy.autoOff };
			if (this.capHit(this.dailyPnl(outcomes))) return { ok: false, reason: "Daily loss cap hit" };
			if (tilt !== null) return { ok: false, reason: `Tilt cooldown until ${localClock(tilt, this.tzOffsetMin())}` };
			if (opts.signal !== "approved") return { ok: false, reason: copy.notApproved };
			return { ok: true };
		}

		if (tilt !== null && !opts.holdConfirmed) return { ok: false, reason: "Hold to confirm during tilt" };
		if (opts.signal === "rejected" && !opts.holdConfirmed) return { ok: false, reason: copy.rejectedHold };
		return { ok: true };
	}

	private dailyPnl(outcomes: readonly Outcome[]): bigint {
		return dailyPnl(outcomes, this.deps.clock.now(), this.tzOffsetMin());
	}

	private capHit(daily: bigint): boolean {
		return daily <= -this.deps.limits().dailyLossCap;
	}

	private activeTilt(outcomes: readonly Outcome[]): number | null {
		const limits = this.deps.limits();
		const until = tiltUntilOf(outcomes, limits.tiltLosses, limits.tiltCooldownMin);
		return until !== null && until > this.deps.clock.now() ? until : null;
	}
}
