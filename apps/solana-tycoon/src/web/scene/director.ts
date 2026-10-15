import type { EngineEvent } from "../../shared/protocol";
import { solToLamports } from "../../shared/units";
import type { SfxId } from "../audio/sfx";
import { type GameState, sessionLamports } from "../state/store";
import type { CastId } from "./office";

export type CharacterState = "idle" | "work" | "celebrate" | "alarm" | "sleep" | "fail" | "dance" | "sweat";

export type Reaction =
	| { cast: CastId; state: CharacterState; ms: number; bubble?: string }
	| { effect: "coins" | "confetti"; count: number }
	| { effect: "shake"; px: number; ms: number }
	| { effect: "banner"; text: string }
	| { sfx: SfxId };

const CAST: readonly CastId[] = ["zorp", "vera", "rex", "gloop", "ceo"];
const SWEAT_AT = -solToLamports(0.05);

// Maps each engine event to what the crew, effects, and sound do about it (spec 7.3 and 7.5).
export function reactionsFor(_prev: GameState, next: GameState, event: EngineEvent): Reaction[] {
	switch (event.type) {
		case "launch":
			return [{ cast: "zorp", state: "celebrate", ms: 1200 }, { sfx: "launch" }];
		case "check":
			if (event.check.verdict === "approved") {
				return [{ cast: "vera", state: "celebrate", ms: 2500, bubble: "APPROVED" }, { sfx: "approve" }];
			}
			if (event.check.verdict === "rejected") {
				return [
					{ cast: "vera", state: "alarm", ms: 2500, bubble: event.check.reason },
					{ cast: "zorp", state: "alarm", ms: 2000 },
					{ sfx: "reject" },
				];
			}
			return [];
		case "feed":
			if (event.status === "down") return [{ cast: "zorp", state: "sleep", ms: 0 }];
			if (event.status === "live") return [{ cast: "zorp", state: "idle", ms: 0 }];
			return [];
		case "order": {
			if (event.order.status === "pending") return [{ cast: "rex", state: "work", ms: 0 }];
			const stillPending = Object.values(next.orders).some((order) => order.status === "pending");
			const base: Reaction = { cast: "rex", state: stillPending ? "work" : "idle", ms: 0 };
			if (event.order.status === "filled")
				return [base, { cast: "rex", state: "celebrate", ms: 1500 }, { sfx: "fill" }];
			return [base, { cast: "rex", state: "fail", ms: 2000, bubble: event.order.error ?? "Order failed" }];
		}
		case "close": {
			if (BigInt(event.trade.pnlLamports) <= 0n)
				return [{ cast: "gloop", state: "sweat", ms: 2500 }, { sfx: "loss" }];
			const combo = next.combo;
			const reactions: Reaction[] = [{ cast: "gloop", state: "celebrate", ms: 2000 }];
			if (combo >= 2) reactions.push({ effect: "banner", text: `COMBO x${combo}` }, { sfx: "combo" });
			if (combo >= 3) reactions.push({ effect: "coins", count: 40 }, { effect: "shake", px: 2, ms: 400 });
			if (combo >= 4) for (const cast of CAST) reactions.push({ cast, state: "dance", ms: 3000 });
			if (combo >= 5) {
				reactions.push(
					{ effect: "confetti", count: 120 },
					{ effect: "shake", px: 4, ms: 600 },
					{ sfx: "fever" },
					{ cast: "ceo", state: "dance", ms: 0 },
				);
			}
			return reactions;
		}
		default:
			return [];
	}
}

// The CEO's resting state follows session PnL and dances on the desk in FEVER.
export function ceoMood(state: GameState): CharacterState {
	if (state.tier === "fever") return "dance";
	const session = sessionLamports(state);
	if (session > 0n) return "celebrate";
	if (session <= SWEAT_AT) return "sweat";
	return "idle";
}
