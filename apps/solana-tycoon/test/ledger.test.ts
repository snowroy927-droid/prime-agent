import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ledger, type LedgerRecord, rebuild } from "../src/engine/ledger/ledger";
import type { Fill } from "../src/shared/types";

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ledger-"));
	file = join(dir, "nested", "ledger.jsonl");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const fill = (over: Partial<Fill>): Fill => ({
	id: "f1",
	positionId: "p1",
	mode: "paper",
	mint: "Mint111",
	symbol: "ZORP",
	side: "buy",
	solLamports: "50000000",
	tokenAmount: "1000000",
	feesLamports: "2544280",
	ts: 1_000,
	...over,
});

describe("ledger", () => {
	it("rebuilds a closed trade from a buy, two half sells, and a close", () => {
		const ledger = new Ledger(file);
		ledger.appendFill(fill({}));
		ledger.appendFill(
			fill({
				id: "f2",
				side: "sell",
				solLamports: "40000000",
				tokenAmount: "500000",
				feesLamports: "5000",
				ts: 2_000,
			}),
		);
		ledger.appendFill(
			fill({
				id: "f3",
				side: "sell",
				solLamports: "30000000",
				tokenAmount: "500000",
				feesLamports: "5000",
				ts: 3_000,
			}),
		);
		ledger.appendClose({
			positionId: "p1",
			mode: "paper",
			pnlLamports: "0",
			pnlPct: 0,
			reason: "take_profit",
			ts: 3_100,
		});

		const state = new Ledger(file).load();
		expect(state.warnings).toEqual([]);
		expect(state.open).toEqual([]);
		expect(state.closed).toHaveLength(1);
		const cost = 50_000_000n + 2_544_280n;
		const proceeds = 40_000_000n - 5_000n + (30_000_000n - 5_000n);
		expect(state.closed[0]).toEqual({
			positionId: "p1",
			mode: "paper",
			mint: "Mint111",
			symbol: "ZORP",
			costLamports: cost.toString(),
			proceedsLamports: proceeds.toString(),
			pnlLamports: (proceeds - cost).toString(),
			pnlPct: (Number(proceeds - cost) / Number(cost)) * 100,
			reason: "take_profit",
			openedAt: 1_000,
			closedAt: 3_100,
		});
	});

	it("keeps a position without a close as an open lot", () => {
		const records: LedgerRecord[] = [
			{ kind: "fill", ...fill({}) },
			{
				kind: "fill",
				...fill({ id: "f2", side: "sell", tokenAmount: "400000", solLamports: "20000000", feesLamports: "5000" }),
			},
		];
		const state = rebuild(records);
		expect(state.closed).toEqual([]);
		expect(state.open).toEqual([
			{
				positionId: "p1",
				mode: "paper",
				mint: "Mint111",
				symbol: "ZORP",
				openedAt: 1_000,
				costLamports: 52_544_280n,
				proceedsLamports: 19_995_000n,
				tokenAmount: 600_000n,
			},
		]);
	});

	it("loads earlier records when the last line is truncated", () => {
		const ledger = new Ledger(file);
		ledger.appendFill(fill({}));
		appendFileSync(file, '{"kind":"fill","id":"f2","positionId":"p');
		const state = new Ledger(file).load();
		expect(state.open).toHaveLength(1);
		expect(state.warnings).toEqual(["Skipped malformed ledger line 2"]);
	});

	it("starts a fresh line when appending after a truncated write", () => {
		new Ledger(file).appendFill(fill({}));
		appendFileSync(file, '{"kind":"fill","id":"f2"');
		new Ledger(file).appendFill(fill({ id: "f3", positionId: "p2", ts: 5_000 }));
		const state = new Ledger(file).load();
		expect(state.open.map((lot) => lot.positionId)).toEqual(["p1", "p2"]);
		expect(state.warnings).toEqual(["Skipped malformed ledger line 2"]);
	});

	it("skips garbage and schema-invalid lines and keeps the rest", () => {
		const lines = [
			JSON.stringify({ kind: "fill", ...fill({}) }),
			"not json at all",
			JSON.stringify({ kind: "fill", ...fill({ id: "f2", positionId: "p2" }) }),
			JSON.stringify({ kind: "fill", ...fill({ id: "f3", positionId: "p3", solLamports: "1.5" }) }),
			JSON.stringify({ kind: "fill", ...fill({ id: "f4", positionId: "p4" }) }),
		];
		new Ledger(file).reset();
		writeFileSync(file, `${lines.join("\n")}\n`);
		const state = new Ledger(file).load();
		expect(state.warnings).toEqual(["Skipped malformed ledger line 2", "Skipped malformed ledger line 4"]);
		expect(state.open.map((lot) => lot.positionId)).toEqual(["p1", "p2", "p4"]);
	});

	it("returns an empty state when the file does not exist", () => {
		expect(new Ledger(file).load()).toEqual({ open: [], closed: [], warnings: [] });
	});

	it("reset empties the file", () => {
		const ledger = new Ledger(file);
		ledger.appendFill(fill({}));
		ledger.reset();
		expect(readFileSync(file, "utf8")).toBe("");
		expect(ledger.load()).toEqual({ open: [], closed: [], warnings: [] });
	});
});
