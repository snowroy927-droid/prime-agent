import type { Settings } from "../../shared/settings";
import { consecutiveLosses, tiltUntil } from "../../shared/tilt";
import type { ClosedTrade, RiskState, Verdict } from "../../shared/types";
import { solToLamports } from "../../shared/units";
import type { Clock } from "../clock";

export type OpenKind = "auto" | "manual";

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

export function dailyPnlLamports(closes: readonly ClosedTrade[], now: number, tzOffsetMin: number): bigint {
	const start = localDayStart(now, tzOffsetMin);
	return closes
		.filter((trade) => trade.closedAt >= start && trade.closedAt <= now)
		.reduce((total, trade) => total + BigInt(trade.pnlLamports), 0n);
}

function localClock(at: number, tzOffsetMin: number): string {
	const local = new Date(at + tzOffsetMin * MINUTE_MS);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export interface RiskGuardDeps {
	clock: Clock;
	settings: () => Settings;
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

	state(closes: readonly ClosedTrade[]): RiskState {
		const settings = this.deps.settings();
		const daily = this.dailyPnl(closes);
		return {
			autoSnipe: settings.autoSnipe,
			paused: this.paused,
			pausedReason: this.pausedReason,
			tiltLosses: consecutiveLosses(closes),
			tiltUntil: this.activeTilt(closes),
			dailyPnlLamports: daily.toString(),
			dailyCapUntil: this.capHit(daily) ? nextLocalMidnight(this.deps.clock.now(), this.tzOffsetMin()) : null,
		};
	}

	canOpen(
		kind: OpenKind,
		closes: readonly ClosedTrade[],
		openCount: number,
		opts: { holdConfirmed: boolean; checkVerdict: Verdict | null },
	): { ok: true } | { ok: false; reason: string } {
		const settings = this.deps.settings();
		if (this.paused) return { ok: false, reason: "Engine paused" };
		if (openCount >= settings.maxPositions)
			return { ok: false, reason: `Max positions (${settings.maxPositions}) reached` };
		const tilt = this.activeTilt(closes);

		if (kind === "auto") {
			if (!settings.autoSnipe) return { ok: false, reason: "Auto-snipe off" };
			if (this.capHit(this.dailyPnl(closes))) return { ok: false, reason: "Daily loss cap hit" };
			if (tilt !== null) return { ok: false, reason: `Tilt cooldown until ${localClock(tilt, this.tzOffsetMin())}` };
			if (opts.checkVerdict !== "approved") return { ok: false, reason: "Not approved" };
			return { ok: true };
		}

		if (tilt !== null && !opts.holdConfirmed) return { ok: false, reason: "Hold to confirm during tilt" };
		if (opts.checkVerdict === "rejected" && !opts.holdConfirmed) {
			return { ok: false, reason: "Hold to snipe a rejected coin" };
		}
		return { ok: true };
	}

	private dailyPnl(closes: readonly ClosedTrade[]): bigint {
		return dailyPnlLamports(closes, this.deps.clock.now(), this.tzOffsetMin());
	}

	private capHit(daily: bigint): boolean {
		return daily <= -solToLamports(this.deps.settings().dailyLossCapSol);
	}

	private activeTilt(closes: readonly ClosedTrade[]): number | null {
		const until = tiltUntil(closes, this.deps.settings());
		return until !== null && until > this.deps.clock.now() ? until : null;
	}
}
