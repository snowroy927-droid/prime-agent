import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modeDefaultsFor, SettingsStore } from "../src/engine/settingsStore";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "settings-"));
	file = join(dir, "data", "settings.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("SettingsStore", () => {
	it("creates the file from defaults merged with mode defaults", () => {
		const store = new SettingsStore(file, modeDefaultsFor("live"));
		expect(existsSync(file)).toBe(true);
		expect(store.get().autoSnipe).toBe(false);
		expect(store.get().buySol).toBe(DEFAULT_SETTINGS.buySol);
		expect(JSON.parse(readFileSync(file, "utf8")).autoSnipe).toBe(false);
	});

	it("disables auto-snipe by default only in live mode", () => {
		expect(modeDefaultsFor("live")).toEqual({ autoSnipe: false });
		expect(modeDefaultsFor("paper")).toEqual({});
	});

	it("leaves the file untouched on an invalid update", () => {
		const store = new SettingsStore(file, {});
		const before = readFileSync(file);
		const result = store.update({ takeProfitPct: -5 });
		expect(result.ok).toBe(false);
		expect(readFileSync(file).equals(before)).toBe(true);
		expect(store.get().takeProfitPct).toBe(DEFAULT_SETTINGS.takeProfitPct);
	});

	it("persists a valid update and reloads it", () => {
		const store = new SettingsStore(file, {});
		const result = store.update({ buySol: 0.02, rug: { minRealSol: 2 } });
		expect(result.ok).toBe(true);
		const reloaded = new SettingsStore(file, {});
		expect(reloaded.get().buySol).toBe(0.02);
		expect(reloaded.get().rug.minRealSol).toBe(2);
		expect(reloaded.get().rug.maxTopHolderPct).toBe(DEFAULT_SETTINGS.rug.maxTopHolderPct);
	});

	it("does not let callers mutate stored settings", () => {
		const store = new SettingsStore(file, {});
		store.get().rug.blocklist.push("mutated");
		expect(store.get().rug.blocklist).toEqual(DEFAULT_SETTINGS.rug.blocklist);
	});

	it("refuses to start from a corrupt settings file instead of silently resetting it", () => {
		new SettingsStore(file, {});
		writeFileSync(file, '{"buySol": "lots"}');
		expect(() => new SettingsStore(file, {})).toThrow(file);
		expect(readFileSync(file, "utf8")).toBe('{"buySol": "lots"}');
	});
});
