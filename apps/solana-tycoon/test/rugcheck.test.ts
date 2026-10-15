import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BN from "bn.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splToken, web3 } from "../src/engine/chain/solana";
import type { HolderSummary } from "../src/engine/chain/types";
import { ManualClock } from "../src/engine/clock";
import { LaunchHistory } from "../src/engine/scout/launchHistory";
import { evaluateRules, HARD_RULES, type RugInput } from "../src/engine/scout/rugcheck";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import type { Launch, RuleId } from "../src/shared/types";
import { fixtureCurve } from "./helpers/curves";

const rug = DEFAULT_SETTINGS.rug;
const SUPPLY = 1_000_000_000_000_000n;

const launch = (over: Partial<Launch> = {}): Launch => ({
	mint: web3.Keypair.generate().publicKey.toBase58(),
	name: "Zorp Coin",
	symbol: "ZORP",
	creator: "Creator111",
	signature: null,
	uri: null,
	marketCapSol: null,
	receivedAt: 0,
	...over,
});

const spread = (count: number, eachPct = 1): HolderSummary => ({
	supply: SUPPLY,
	curveAccount: "curve",
	holders: Array.from({ length: count }, (_, i) => ({
		account: `h${i}`,
		amount: (SUPPLY * BigInt(Math.round(eachPct * 100))) / 10_000n,
	})),
});

const input = (over: Partial<RugInput> = {}): RugInput => ({
	launch: launch(),
	curve: fixtureCurve({ realQuoteReserves: new BN(1_500_000_000) }),
	holders: spread(12),
	creatorLaunchesInWindow: 1,
	...over,
});

function result(rule: RuleId, over: Partial<RugInput> = {}) {
	const found = evaluateRules(input(over), rug).find((r) => r.rule === rule);
	if (!found) throw new Error(`rule ${rule} missing`);
	return found;
}

describe("evaluateRules", () => {
	it("returns all eight rules in RuleId order, all passing for a clean coin", () => {
		const results = evaluateRules(input(), rug);
		expect(results.map((r) => r.rule)).toEqual([
			"quote_sol",
			"not_mayhem",
			"curve_live",
			"blocklist",
			"serial_launcher",
			"top_holder",
			"holder_spread",
			"min_real_sol",
		]);
		expect(results.every((r) => r.pass)).toBe(true);
		expect(HARD_RULES).toEqual(["quote_sol", "not_mayhem", "curve_live", "blocklist", "serial_launcher"]);
	});

	it("checks the quote mint", () => {
		expect(result("quote_sol")).toEqual({ rule: "quote_sol", pass: true, reason: "Priced in SOL" });
		expect(result("quote_sol", { curve: fixtureCurve({ quoteMint: splToken.NATIVE_MINT }) }).pass).toBe(true);
		const usdc = new web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
		expect(result("quote_sol", { curve: fixtureCurve({ quoteMint: usdc }) })).toEqual({
			rule: "quote_sol",
			pass: false,
			reason: "Not priced in SOL",
		});
	});

	it("checks mayhem mode and curve state", () => {
		expect(result("not_mayhem").reason).toBe("Normal curve");
		expect(result("not_mayhem", { curve: fixtureCurve({ isMayhemMode: true }) })).toMatchObject({
			pass: false,
			reason: "Mayhem-mode coin",
		});
		expect(result("curve_live").reason).toBe("Curve live");
		expect(result("curve_live", { curve: fixtureCurve({ complete: true }) })).toMatchObject({
			pass: false,
			reason: "Curve complete or migrated",
		});
	});

	it("matches blocklist words case-insensitively in name and symbol", () => {
		expect(result("blocklist").reason).toBe("Name clean");
		expect(result("blocklist", { launch: launch({ name: "Totally Not A RUG" }) })).toMatchObject({
			pass: false,
			reason: 'Name contains "rug"',
		});
		expect(result("blocklist", { launch: launch({ symbol: "sCaMx" }) })).toMatchObject({
			pass: false,
			reason: 'Name contains "scam"',
		});
	});

	it("fails serial launchers at the configured count", () => {
		expect(result("serial_launcher", { creatorLaunchesInWindow: 2 })).toMatchObject({
			pass: true,
			reason: "Creator launched 2 in 60m",
		});
		expect(result("serial_launcher", { creatorLaunchesInWindow: 3 })).toMatchObject({
			pass: false,
			reason: "Serial launcher: 3 coins in 60m",
		});
	});

	it("checks the largest holder against the cap", () => {
		expect(result("top_holder")).toMatchObject({ pass: true, reason: "Top holder 1.0% (max 20%)" });
		const whale: HolderSummary = {
			...spread(12),
			holders: [...spread(11).holders, { account: "w", amount: SUPPLY / 4n }],
		};
		expect(result("top_holder", { holders: whale })).toMatchObject({
			pass: false,
			reason: "Top holder 25.0% (max 20%)",
		});
	});

	it("checks holder spread, ignoring empty accounts", () => {
		expect(result("holder_spread")).toMatchObject({ pass: true, reason: "12 holders in top 20 (min 10)" });
		const thin: HolderSummary = { ...spread(9), holders: [...spread(9).holders, { account: "z", amount: 0n }] };
		expect(result("holder_spread", { holders: thin })).toMatchObject({
			pass: false,
			reason: "9 holders in top 20 (min 10)",
		});
	});

	it("fails holder rules when holder data is unavailable", () => {
		expect(result("top_holder", { holders: null })).toMatchObject({ pass: false, reason: "Holder data unavailable" });
		expect(result("holder_spread", { holders: null })).toMatchObject({
			pass: false,
			reason: "Holder data unavailable",
		});
	});

	it("checks real SOL in the curve", () => {
		expect(result("min_real_sol")).toMatchObject({ pass: true, reason: "1.50 SOL in curve (min 1)" });
		expect(result("min_real_sol", { curve: fixtureCurve({ realQuoteReserves: new BN(400_000_000) }) })).toMatchObject(
			{
				pass: false,
				reason: "0.40 SOL in curve (min 1)",
			},
		);
	});
});

describe("LaunchHistory", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "launches-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("counts launches inside the window and ignores repeated mints", () => {
		const clock = new ManualClock(0);
		const history = new LaunchHistory(null, clock);
		const min = 60_000;
		history.record("c", "m1", 0);
		history.record("c", "m2", 5 * min);
		history.record("c", "m3", 10 * min);
		history.record("c", "m3", 10 * min);
		expect(history.countInWindow("c", 60 * min, 10 * min)).toBe(3);
		history.record("c", "m4", 61 * min);
		expect(history.countInWindow("c", 60 * min, 61 * min)).toBe(3);
		history.record("c", "m5", 71 * min);
		expect(history.countInWindow("c", 60 * min, 71 * min)).toBe(2);
		expect(history.countInWindow("other", 60 * min, 71 * min)).toBe(0);
	});

	it("persists, reloads, and prunes entries older than 24 hours on load", () => {
		const file = join(dir, "data", "launches.jsonl");
		const day = 24 * 3_600_000;
		const clock = new ManualClock(2 * day);
		const history = new LaunchHistory(file, clock);
		history.record("c", "old", day - 1);
		history.record("c", "new", 2 * day - 1_000);
		const reloaded = new LaunchHistory(file, clock);
		expect(reloaded.countInWindow("c", 2 * day, 2 * day)).toBe(1);
		expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
	});

	it("skips malformed lines when loading", () => {
		const file = join(dir, "launches.jsonl");
		writeFileSync(file, `not json\n${JSON.stringify({ creator: "c", mint: "m", at: 10 })}\n{"creator":1}\n`);
		const history = new LaunchHistory(file, new ManualClock(100));
		expect(history.countInWindow("c", 1_000, 100)).toBe(1);
	});
});
