import { readFileSync } from "node:fs";
import { z } from "zod";
import { FeedStatusSchema } from "../../shared/protocol";
import type { FeedStatus } from "../../shared/types";

export type RecordingLine =
	| { t: number; kind: "meta"; synthetic: boolean; description: string; createdAt: string }
	| { t: number; kind: "globals"; globals: unknown }
	| { t: number; kind: "launch"; raw: string }
	| { t: number; kind: "curve"; mint: string; snap: unknown }
	| { t: number; kind: "holders"; mint: string; holders: unknown }
	| { t: number; kind: "pool"; mint: string; pool: unknown }
	| { t: number; kind: "feed"; status: FeedStatus }
	| { t: number; kind: "kraken_ws"; raw: string }
	| { t: number; kind: "kraken_rest"; endpoint: KrakenEndpoint; query: string; body: unknown }
	| { t: number; kind: "kraken_feed"; status: FeedStatus };

export type KrakenEndpoint = "AssetPairs" | "Ticker" | "OHLC";

const t = z.number().nonnegative();

const RecordingLineSchema = z.discriminatedUnion("kind", [
	z.object({ t, kind: z.literal("meta"), synthetic: z.boolean(), description: z.string(), createdAt: z.string() }),
	z.object({ t, kind: z.literal("globals"), globals: z.json() }),
	z.object({ t, kind: z.literal("launch"), raw: z.string() }),
	z.object({ t, kind: z.literal("curve"), mint: z.string(), snap: z.json() }),
	z.object({ t, kind: z.literal("holders"), mint: z.string(), holders: z.json() }),
	z.object({ t, kind: z.literal("pool"), mint: z.string(), pool: z.json() }),
	z.object({ t, kind: z.literal("feed"), status: FeedStatusSchema }),
	z.object({ t, kind: z.literal("kraken_ws"), raw: z.string() }),
	z.object({
		t,
		kind: z.literal("kraken_rest"),
		endpoint: z.enum(["AssetPairs", "Ticker", "OHLC"]),
		query: z.string(),
		body: z.json(),
	}),
	z.object({ t, kind: z.literal("kraken_feed"), status: FeedStatusSchema }),
]);

export function formatRecording(lines: readonly RecordingLine[]): string {
	return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

// Lines that fail to parse (for example a recording cut off mid-write) are skipped.
export function readRecording(path: string): RecordingLine[] {
	const lines: RecordingLine[] = [];
	for (const text of readFileSync(path, "utf8").split("\n")) {
		if (text.trim() === "") continue;
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			continue;
		}
		const parsed = RecordingLineSchema.safeParse(data);
		if (parsed.success) lines.push(parsed.data);
	}
	return lines.sort((a, b) => a.t - b.t);
}
