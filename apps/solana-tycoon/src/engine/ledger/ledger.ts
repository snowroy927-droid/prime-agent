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
import { z } from "zod";
import { ExitReasonSchema, FillSchema, LamportsSchema, ModeSchema } from "../../shared/protocol";
import type { ClosedTrade, ExitReason, Fill, Mode } from "../../shared/types";

export type LedgerRecord =
	| ({ kind: "fill" } & Fill)
	| {
			kind: "close";
			positionId: string;
			mode: Mode;
			pnlLamports: string;
			pnlPct: number;
			reason: ExitReason;
			ts: number;
	  };

export interface OpenLot {
	positionId: string;
	mode: Mode;
	mint: string;
	symbol: string;
	openedAt: number;
	costLamports: bigint;
	proceedsLamports: bigint;
	tokenAmount: bigint;
}

export interface LedgerState {
	open: OpenLot[];
	closed: ClosedTrade[];
	warnings: string[];
}

type CloseRecord = Extract<LedgerRecord, { kind: "close" }>;

const LedgerRecordSchema = z.discriminatedUnion("kind", [
	FillSchema.extend({ kind: z.literal("fill") }),
	z.object({
		kind: z.literal("close"),
		positionId: z.string(),
		mode: ModeSchema,
		pnlLamports: LamportsSchema,
		pnlPct: z.number(),
		reason: ExitReasonSchema,
		ts: z.number(),
	}),
]) satisfies z.ZodType<LedgerRecord>;

export function rebuild(records: readonly LedgerRecord[]): Omit<LedgerState, "warnings"> {
	const lots = new Map<string, OpenLot>();
	const closed: ClosedTrade[] = [];
	const closedIds = new Set<string>();

	for (const record of records) {
		if (closedIds.has(record.positionId)) continue;
		if (record.kind === "fill") {
			let lot = lots.get(record.positionId);
			if (!lot) {
				lot = {
					positionId: record.positionId,
					mode: record.mode,
					mint: record.mint,
					symbol: record.symbol,
					openedAt: record.ts,
					costLamports: 0n,
					proceedsLamports: 0n,
					tokenAmount: 0n,
				};
				lots.set(record.positionId, lot);
			}
			const sol = BigInt(record.solLamports);
			const fees = BigInt(record.feesLamports);
			const tokens = BigInt(record.tokenAmount);
			if (record.side === "buy") {
				lot.costLamports += sol + fees;
				lot.tokenAmount += tokens;
			} else {
				lot.proceedsLamports += sol - fees;
				lot.tokenAmount -= tokens;
			}
			continue;
		}
		const lot = lots.get(record.positionId);
		if (!lot) continue;
		lots.delete(record.positionId);
		closedIds.add(record.positionId);
		const pnl = lot.proceedsLamports - lot.costLamports;
		closed.push({
			positionId: lot.positionId,
			mode: lot.mode,
			mint: lot.mint,
			symbol: lot.symbol,
			costLamports: lot.costLamports.toString(),
			proceedsLamports: lot.proceedsLamports.toString(),
			pnlLamports: pnl.toString(),
			pnlPct: lot.costLamports === 0n ? 0 : (Number(pnl) / Number(lot.costLamports)) * 100,
			reason: record.reason,
			openedAt: lot.openedAt,
			closedAt: record.ts,
		});
	}

	return { open: [...lots.values()], closed };
}

export class Ledger {
	private checkedTail = false;

	constructor(private readonly filePath: string) {}

	load(): LedgerState {
		if (!existsSync(this.filePath)) return { open: [], closed: [], warnings: [] };
		const records: LedgerRecord[] = [];
		const warnings: string[] = [];
		const lines = readFileSync(this.filePath, "utf8").split("\n");
		lines.forEach((line, index) => {
			if (line.trim() === "") return;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				warnings.push(`Skipped malformed ledger line ${index + 1}`);
				return;
			}
			const result = LedgerRecordSchema.safeParse(parsed);
			if (result.success) records.push(result.data);
			else warnings.push(`Skipped malformed ledger line ${index + 1}`);
		});
		return { ...rebuild(records), warnings };
	}

	appendFill(fill: Fill): void {
		this.appendRecord({ kind: "fill", ...fill });
	}

	appendClose(record: Omit<CloseRecord, "kind">): void {
		this.appendRecord({ kind: "close", ...record });
	}

	reset(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(this.filePath, "");
		this.checkedTail = true;
	}

	private appendRecord(record: LedgerRecord): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		// A crash mid-write can leave a partial last line; start on a fresh line so the
		// new record is not glued onto it and lost with it.
		const prefix = !this.checkedTail && this.endsMidLine() ? "\n" : "";
		this.checkedTail = true;
		appendFileSync(this.filePath, `${prefix}${JSON.stringify(record)}\n`);
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
