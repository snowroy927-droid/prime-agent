import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KrakenLedger } from "../src/engine/kraken/ledger";
import type { KrakenFill } from "../src/shared/kraken";

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kledger-"));
	file = join(dir, "data", "ledger-kraken-paper.jsonl");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const fill = (over: Partial<KrakenFill>): KrakenFill => ({
	id: "f1",
	positionId: "k1",
	mode: "paper",
	pair: "PEPEUSD",
	symbol: "PEPE",
	side: "buy",
	usdMicros: "50000000",
	lots: "4000000",
	feesUsdMicros: "400000",
	ts: 1_000,
	...over,
});

describe("KrakenLedger", () => {
	it("rebuilds a closed trade from a buy, two half sells and a close", () => {
		const ledger = new KrakenLedger(file);
		ledger.appendFill(fill({}));
		ledger.appendFill(
			fill({ id: "f2", side: "sell", usdMicros: "30000000", lots: "2000000", feesUsdMicros: "240000", ts: 2_000 }),
		);
		ledger.appendFill(
			fill({ id: "f3", side: "sell", usdMicros: "26000000", lots: "2000000", feesUsdMicros: "208000", ts: 3_000 }),
		);
		ledger.appendClose({
			positionId: "k1",
			mode: "paper",
			pnlUsdMicros: "5152000",
			pnlPct: 10.2222,
			reason: "take_profit",
			ts: 3_000,
		});
		const state = new KrakenLedger(file).load();
		expect(state.warnings).toEqual([]);
		expect(state.open).toEqual([]);
		expect(state.closed).toEqual([
			{
				positionId: "k1",
				mode: "paper",
				pair: "PEPEUSD",
				symbol: "PEPE",
				costUsdMicros: "50400000",
				proceedsUsdMicros: "55552000",
				pnlUsdMicros: "5152000",
				pnlPct: (5_152_000 / 50_400_000) * 100,
				reason: "take_profit",
				openedAt: 1_000,
				closedAt: 3_000,
			},
		]);
	});

	it("keeps an unclosed position as an open lot", () => {
		const ledger = new KrakenLedger(file);
		ledger.appendFill(fill({}));
		expect(ledger.load().open).toEqual([
			{
				positionId: "k1",
				mode: "paper",
				pair: "PEPEUSD",
				symbol: "PEPE",
				openedAt: 1_000,
				costUsdMicros: 50_400_000n,
				proceedsUsdMicros: 0n,
				lots: 4_000_000n,
			},
		]);
	});

	it("skips a malformed line in the middle and keeps the rest", () => {
		new KrakenLedger(file).reset();
		writeFileSync(
			file,
			`${[
				JSON.stringify({ kind: "fill", ...fill({}) }),
				"{broken",
				JSON.stringify({ kind: "fill", ...fill({ id: "f9", positionId: "k2" }) }),
			].join("\n")}\n`,
		);
		const state = new KrakenLedger(file).load();
		expect(state.warnings).toEqual(["Skipped malformed ledger line 2"]);
		expect(state.open.map((lot) => lot.positionId)).toEqual(["k1", "k2"]);
	});
});
