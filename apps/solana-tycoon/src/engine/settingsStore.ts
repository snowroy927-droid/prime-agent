import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applySettingsPatch, DEFAULT_SETTINGS, type PatchResult, type Settings } from "../shared/settings";
import type { Mode } from "../shared/types";

export function modeDefaultsFor(mode: Mode): Partial<Settings> {
	return mode === "live" ? { autoSnipe: false } : {};
}

// Settings persisted as JSON and validated by `apply`. A corrupt or invalid file stops startup rather than
// silently resetting risk settings.
export class JsonSettingsStore<T> {
	private settings: T;

	constructor(
		private readonly filePath: string,
		defaults: T,
		private readonly apply: (current: T, patch: unknown) => PatchResult<T>,
	) {
		if (!existsSync(filePath)) {
			this.settings = structuredClone(defaults);
			this.persist(this.settings);
			return;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(filePath, "utf8"));
		} catch {
			throw new Error(`Settings file ${filePath} is not valid JSON; fix it or delete it to restore defaults`);
		}
		const loaded = apply(defaults, raw);
		if (!loaded.ok) {
			throw new Error(
				`Settings file ${filePath} is invalid (${loaded.error}); fix it or delete it to restore defaults`,
			);
		}
		this.settings = loaded.settings;
	}

	get(): T {
		return structuredClone(this.settings);
	}

	update(patch: unknown): PatchResult<T> {
		const result = this.apply(this.settings, patch);
		if (!result.ok) return result;
		this.persist(result.settings);
		this.settings = result.settings;
		return { ok: true, settings: structuredClone(result.settings) };
	}

	private persist(settings: T): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		const temp = `${this.filePath}.tmp`;
		writeFileSync(temp, `${JSON.stringify(settings, null, "\t")}\n`);
		renameSync(temp, this.filePath);
	}
}

export class SettingsStore extends JsonSettingsStore<Settings> {
	constructor(filePath: string, modeDefaults: Partial<Settings>) {
		const base = applySettingsPatch(DEFAULT_SETTINGS, modeDefaults);
		if (!base.ok) throw new Error(`Invalid mode default settings: ${base.error}`);
		super(filePath, base.settings, applySettingsPatch);
	}
}
