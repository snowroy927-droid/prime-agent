import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Clock } from "../clock";

const RETENTION_MS = 24 * 3_600_000;

const EntrySchema = z.object({ creator: z.string(), mint: z.string(), at: z.number() });
type Entry = z.infer<typeof EntrySchema>;

// Creator launch log for the serial-launcher rule, kept for 24 hours.
export class LaunchHistory {
	private entries: Entry[] = [];
	private readonly mints = new Set<string>();

	constructor(
		private readonly filePath: string | null,
		clock: Clock,
	) {
		if (!filePath || !existsSync(filePath)) return;
		const cutoff = clock.now() - RETENTION_MS;
		for (const line of readFileSync(filePath, "utf8").split("\n")) {
			if (line.trim() === "") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			const entry = EntrySchema.safeParse(parsed);
			if (entry.success && entry.data.at >= cutoff && !this.mints.has(entry.data.mint)) {
				this.entries.push(entry.data);
				this.mints.add(entry.data.mint);
			}
		}
		writeFileSync(filePath, this.entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
	}

	record(creator: string, mint: string, at: number): void {
		if (this.mints.has(mint)) return;
		const entry: Entry = { creator, mint, at };
		this.entries.push(entry);
		this.mints.add(mint);
		if (this.filePath) {
			mkdirSync(dirname(this.filePath), { recursive: true });
			appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
		}
	}

	countInWindow(creator: string, windowMs: number, now: number): number {
		return this.entries.filter((entry) => entry.creator === creator && entry.at > now - windowMs && entry.at <= now)
			.length;
	}
}
