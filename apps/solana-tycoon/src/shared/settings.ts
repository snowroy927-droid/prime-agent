import { z } from "zod";

export const HARD_LIMITS = { buySolMax: 1, maxPositionsMax: 10 } as const;

const RugSettingsSchema = z.strictObject({
	blocklist: z.array(z.string()),
	serialLaunchMax: z.number().int().positive(),
	serialWindowMin: z.number().positive(),
	maxTopHolderPct: z.number().min(0).max(100),
	minHoldersInTop20: z.number().int().min(0).max(20),
	minRealSol: z.number().nonnegative(),
});

const PaperSettingsSchema = z.strictObject({
	startingBalanceSol: z.number().positive(),
	latencyMs: z.number().int().nonnegative(),
	extraSlippageBps: z.number().int().min(0).max(5000),
	priorityFeeSol: z.number().nonnegative(),
});

export const SettingsSchema = z.strictObject({
	buySol: z.number().positive(),
	maxPositions: z.number().int().positive(),
	takeProfitPct: z.number().positive(),
	stopLossPct: z.number().positive().max(100),
	trailingStopPct: z.number().min(0).max(100),
	maxHoldMin: z.number().positive(),
	dailyLossCapSol: z.number().positive(),
	tiltLosses: z.number().int().positive(),
	tiltCooldownMin: z.number().positive(),
	autoSnipe: z.boolean(),
	snipeDelaySec: z.number().nonnegative(),
	recheckDelaysSec: z.array(z.number().positive()),
	priceStaleSec: z.number().positive(),
	rug: RugSettingsSchema,
	paper: PaperSettingsSchema,
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
	buySol: 0.05,
	maxPositions: 3,
	takeProfitPct: 100,
	stopLossPct: 30,
	trailingStopPct: 0,
	maxHoldMin: 30,
	dailyLossCapSol: 0.15,
	tiltLosses: 3,
	tiltCooldownMin: 10,
	autoSnipe: true,
	snipeDelaySec: 2,
	recheckDelaysSec: [10, 30],
	priceStaleSec: 10,
	rug: {
		blocklist: ["test", "rug", "scam", "fake", "honeypot"],
		serialLaunchMax: 3,
		serialWindowMin: 60,
		maxTopHolderPct: 20,
		minHoldersInTop20: 10,
		minRealSol: 1.0,
	},
	paper: {
		startingBalanceSol: 1.0,
		latencyMs: 800,
		extraSlippageBps: 300,
		priorityFeeSol: 0.0005,
	},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
	if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		merged[key] = deepMerge(base[key], value);
	}
	return merged;
}

export function applySettingsPatch(
	current: Settings,
	patch: unknown,
): { ok: true; settings: Settings } | { ok: false; error: string } {
	if (!isPlainObject(patch)) return { ok: false, error: "settings patch must be an object" };
	const parsed = SettingsSchema.safeParse(deepMerge(current, patch));
	if (!parsed.success) {
		const error = parsed.error.issues
			.map((issue) => {
				const keys = "keys" in issue ? issue.keys.join(", ") : "";
				const path = [...issue.path.map(String), keys].filter(Boolean).join(".");
				return `${path || "settings"}: ${issue.message}`;
			})
			.join("; ");
		return { ok: false, error };
	}
	const settings = parsed.data;
	settings.buySol = Math.min(settings.buySol, HARD_LIMITS.buySolMax);
	settings.maxPositions = Math.min(settings.maxPositions, HARD_LIMITS.maxPositionsMax);
	return { ok: true, settings };
}
