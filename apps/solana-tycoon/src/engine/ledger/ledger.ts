import { z } from "zod";
import { ExitReasonSchema, FillSchema, LamportsSchema, ModeSchema } from "../../shared/protocol";
import type { ClosedTrade, ExitReason, Fill, Mode } from "../../shared/types";
import { JsonlLog } from "./jsonl";

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
	private readonly log: JsonlLog<LedgerRecord>;

	constructor(filePath: string) {
		this.log = new JsonlLog(filePath, LedgerRecordSchema);
	}

	load(): LedgerState {
		const { records, warnings } = this.log.load();
		return { ...rebuild(records), warnings };
	}

	appendFill(fill: Fill): void {
		this.log.append({ kind: "fill", ...fill });
	}

	appendClose(record: Omit<CloseRecord, "kind">): void {
		this.log.append({ kind: "close", ...record });
	}

	reset(): void {
		this.log.reset();
	}
}
