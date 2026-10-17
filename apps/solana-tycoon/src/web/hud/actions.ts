import type { EngineSnapshot } from "../../shared/protocol";

// A snipe needs a 1.5 s hold during a tilt, for a rejected coin, and for a coin whose verdict this page
// no longer has (a pinned coin that left the radar), since the engine may still hold a rejection for it.
export function holdRequired(snapshot: EngineSnapshot | null, mint: string, now: number): boolean {
	if (!snapshot) return false;
	if (snapshot.risk.tiltUntil !== null && snapshot.risk.tiltUntil > now) return true;
	const entry = snapshot.launches.find((item) => item.launch.mint === mint);
	return !entry || entry.check?.verdict === "rejected";
}

// A Kraken buy needs the hold during a tilt and for any pair the rule did not pass, including one off the radar.
export function krakenHoldRequired(snapshot: EngineSnapshot | null, pair: string, now: number): boolean {
	const kraken = snapshot?.kraken;
	if (!kraken) return false;
	if (kraken.risk.tiltUntil !== null && kraken.risk.tiltUntil > now) return true;
	return kraken.movers.find((mover) => mover.pair === pair)?.status !== "eligible";
}

export interface HudActions {
	snipe: (mint: string, holdConfirmed: boolean) => void;
	sell: (mint: string, pct: 50 | 100) => void;
	pin: (mint: string) => void;
	unpin: (mint: string) => void;
	select: (mint: string | null) => void;
	needsHold: (mint: string) => boolean;
}

export interface KrakenActions {
	buy: (pair: string, holdConfirmed: boolean) => void;
	sell: (pair: string, pct: 50 | 100) => void;
	pin: (pair: string) => void;
	unpin: (pair: string) => void;
	select: (pair: string | null) => void;
	needsHold: (pair: string) => boolean;
}
