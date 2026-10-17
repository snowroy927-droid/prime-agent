import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";

// Append-only JSON-lines file. Lines that fail to parse or validate are skipped with their line number.
export class JsonlLog<T> {
	private checkedTail = false;

	constructor(
		private readonly filePath: string,
		private readonly schema: z.ZodType<T>,
	) {}

	load(): { records: T[]; warnings: string[] } {
		if (!existsSync(this.filePath)) return { records: [], warnings: [] };
		const records: T[] = [];
		const warnings: string[] = [];
		readFileSync(this.filePath, "utf8")
			.split("\n")
			.forEach((line, index) => {
				if (line.trim() === "") return;
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					warnings.push(`Skipped malformed ledger line ${index + 1}`);
					return;
				}
				const result = this.schema.safeParse(parsed);
				if (result.success) records.push(result.data);
				else warnings.push(`Skipped malformed ledger line ${index + 1}`);
			});
		return { records, warnings };
	}

	append(record: T): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		// A crash mid-write can leave a partial last line; start on a fresh line so the
		// new record is not glued onto it and lost with it.
		const prefix = !this.checkedTail && this.endsMidLine() ? "\n" : "";
		this.checkedTail = true;
		appendFileSync(this.filePath, `${prefix}${JSON.stringify(record)}\n`);
	}

	reset(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(this.filePath, "");
		this.checkedTail = true;
	}

	private endsMidLine(): boolean {
		if (!existsSync(this.filePath)) return false;
		const size = statSync(this.filePath).size;
		if (size === 0) return false;
		const fd = openSync(this.filePath, "r");
		try {
			const last = Buffer.alloc(1);
			readSync(fd, last, 0, 1, size - 1);
			return last.toString("utf8") !== "\n";
		} finally {
			closeSync(fd);
		}
	}
}
