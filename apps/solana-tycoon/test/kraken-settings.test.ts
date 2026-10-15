import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSettingsStore } from "../src/engine/settingsStore";
import {
	applyKrakenSettingsPatch,
	DEFAULT_KRAKEN_SETTINGS,
	type KrakenClosedTrade,
	krakenOutcome,
} from "../src/shared/kraken";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Kraken settings", () => {
	it("defaults to the spec's Section 12 values", () => {
		expect(DEFAULT_KRAKEN_SETTINGS).toEqual({
			buyUsd: 50,
			maxPositions: 5,
			takeProfitPct: 6,
			stopLossPct: 3,
			trailingStopPct: 2,
			trailingArmPct: 2,
			maxHoldMin: 120,
			dailyLossCapUsd: 60,
			tiltLosses: 3,
			tiltCooldownMin: 30,
			autoBuy: true,
			priceStaleSec: 10,
			scan: {
				minVolumeUsd24h: 250_000,
				maxSpreadPct: 0.6,
				excludeBases: [
					"USDT",
					"USDC",
					"DAI",
					"PYUSD",
					"USDG",
					"TUSD",
					"EURC",
					"EUR",
					"GBP",
					"CAD",
					"AUD",
					"CHF",
					"JPY",
				],
			},
			rule: { minChange15mPct: 4, requireRising5m: true, volumeSurge: 2, reentryCooldownMin: 60 },
			paper: { startingBalanceUsd: 1000, takerFeePct: 0.8, extraSlippageBps: 15, latencyMs: 300 },
		});
	});

	it("clamps buy size and positions to the hard caps", () => {
		const result = applyKrakenSettingsPatch(DEFAULT_KRAKEN_SETTINGS, { buyUsd: 5000, maxPositions: 50 });
		expect(result).toMatchObject({ ok: true, settings: { buyUsd: 1000, maxPositions: 10 } });
	});

	it("rejects invalid values and unknown keys", () => {
		expect(applyKrakenSettingsPatch(DEFAULT_KRAKEN_SETTINGS, { rule: { minChange15mPct: -1 } }).ok).toBe(false);
		expect(applyKrakenSettingsPatch(DEFAULT_KRAKEN_SETTINGS, { bogus: 1 }).ok).toBe(false);
		expect(applyKrakenSettingsPatch(DEFAULT_KRAKEN_SETTINGS, { paper: { takerFeePct: "high" } }).ok).toBe(false);
	});

	it("persists through the generic settings store", () => {
		const dir = mkdtempSync(join(tmpdir(), "ksettings-"));
		dirs.push(dir);
		const file = join(dir, "settings-kraken-paper.json");
		const store = new JsonSettingsStore(file, DEFAULT_KRAKEN_SETTINGS, applyKrakenSettingsPatch);
		expect(store.update({ autoBuy: false }).ok).toBe(true);
		const reloaded = new JsonSettingsStore(file, DEFAULT_KRAKEN_SETTINGS, applyKrakenSettingsPatch);
		expect(reloaded.get().autoBuy).toBe(false);
	});

	it("maps a closed Kraken trade to an outcome in micro-USD", () => {
		const trade: KrakenClosedTrade = {
			positionId: "k1",
			mode: "paper",
			pair: "PEPEUSD",
			symbol: "PEPE",
			costUsdMicros: "50399998",
			proceedsUsdMicros: "52096309",
			pnlUsdMicros: "1696311",
			pnlPct: 3.3657,
			reason: "take_profit",
			openedAt: 1_000,
			closedAt: 9_000,
		};
		expect(krakenOutcome(trade)).toEqual({
			pnl: 1_696_311n,
			openedAt: 1_000,
			closedAt: 9_000,
			reason: "take_profit",
		});
	});
});
