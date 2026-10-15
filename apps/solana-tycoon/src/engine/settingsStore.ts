import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applySettingsPatch, DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import type { Mode } from "../shared/types";

export function modeDefaultsFor(mode: Mode): Partial<Settings> {
	return mode === "live" ? { autoSnipe: false } : {};
}

export class SettingsStore {
	private settings: Settings;

	constructor(
		private readonly filePath: string,
		modeDefaults: Partial<Settings>,
	) {
		const base = applySettingsPatch(DEFAULT_SETTINGS, modeDefaults);
		if (!base.ok) throw new Error(`Invalid mode default settings: ${base.error}`);
		if (!existsSync(filePath)) {
			this.settings = base.settings;
			this.persist(this.settings);
			return;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(filePath, "utf8"));
		} catch {
			throw new Error(`Settings file ${filePath} is not valid JSON; fix it or delete it to restore defaults`);
		}
		const loaded = applySettingsPatch(base.settings, raw);
		if (!loaded.ok) {
			throw new Error(
				`Settings file ${filePath} is invalid (${loaded.error}); fix it or delete it to restore defaults`,
			);
		}
		this.settings = loaded.settings;
	}

	get(): Settings {
		return structuredClone(this.settings);
	}

	update(patch: unknown): { ok: true; settings: Settings } | { ok: false; error: string } {
		const result = applySettingsPatch(this.settings, patch);
		if (!result.ok) return result;
		this.persist(result.settings);
		this.settings = result.settings;
		return { ok: true, settings: structuredClone(result.settings) };
	}

	private persist(settings: Settings): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const temp = `${this.filePath}.tmp`;
		writeFileSync(temp, `${JSON.stringify(settings, null, "\t")}\n`);
		renameSync(temp, this.filePath);
	}
}
