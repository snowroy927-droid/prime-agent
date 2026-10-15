import { z } from "zod";
import type { KrakenClosedTrade, KrakenFill } from "../../shared/kraken";
import { ExitReasonSchema, LamportsSchema, ModeSchema, SideSchema } from "../../shared/protocol";
import type { ExitReason, Mode } from "../../shared/types";
import { JsonlLog } from "../ledger/jsonl";

// LamportsSchema is the integer-string schema; here it carries micro-USD and lots.
const IntegerString = LamportsSchema;

export const KrakenFillSchema = z.object({
	id: z.string(),
	positionId: z.string(),
	mode: ModeSchema,
	pair: z.string(),
	symbol: z.string(),
	side: SideSchema,
	usdMicros: IntegerString,
	lots: IntegerString,
	feesUsdMicros: IntegerString,
	ts: z.number(),
}) satisfies z.ZodType<KrakenFill>;

interface KrakenCloseRecord {
	kind: "close";
	positionId: string;
	mode: Mode;
	pnlUsdMicros: string;
	pnlPct: number;
	reason: ExitReason;
	ts: number;
}

type KrakenLedgerRecord = ({ kind: "fill" } & KrakenFill) | KrakenCloseRecord;

const KrakenLedgerRecordSchema = z.discriminatedUnion("kind", [
	KrakenFillSchema.extend({ kind: z.literal("fill") }),
	z.object({
		kind: z.literal("close"),
		positionId: z.string(),
		mode: ModeSchema,
		pnlUsdMicros: IntegerString,
		pnlPct: z.number(),
		reason: ExitReasonSchema,
		ts: z.number(),
	}),
]) satisfies z.ZodType<KrakenLedgerRecord>;

export interface KrakenLot {
	positionId: string;
	mode: Mode;
	pair: string;
	symbol: string;
	openedAt: number;
	costUsdMicros: bigint;
	proceedsUsdMicros: bigint;
	lots: bigint;
}

// Cost is buys plus fees; proceeds are sells minus fees; a close turns its lot into a closed trade.
function rebuild(records: readonly KrakenLedgerRecord[]): { open: KrakenLot[]; closed: KrakenClosedTrade[] } {
	const lots = new Map<string, KrakenLot>();
	const closed: KrakenClosedTrade[] = [];
	const closedIds = new Set<string>();
	for (const record of records) {
		if (closedIds.has(record.positionId)) continue;
		if (record.kind === "fill") {
			let lot = lots.get(record.positionId);
			if (!lot) {
				lot = {
					positionId: record.positionId,
					mode: record.mode,
					pair: record.pair,
					symbol: record.symbol,
					openedAt: record.ts,
					costUsdMicros: 0n,
					proceedsUsdMicros: 0n,
					lots: 0n,
				};
				lots.set(record.positionId, lot);
			}
			const usd = BigInt(record.usdMicros);
			const fees = BigInt(record.feesUsdMicros);
			if (record.side === "buy") {
				lot.costUsdMicros += usd + fees;
				lot.lots += BigInt(record.lots);
			} else {
				lot.proceedsUsdMicros += usd - fees;
				lot.lots -= BigInt(record.lots);
			}
			continue;
		}
		const lot = lots.get(record.positionId);
		if (!lot) continue;
		lots.delete(record.positionId);
		closedIds.add(record.positionId);
		const pnl = lot.proceedsUsdMicros - lot.costUsdMicros;
		closed.push({
			positionId: lot.positionId,
			mode: lot.mode,
			pair: lot.pair,
			symbol: lot.symbol,
			costUsdMicros: lot.costUsdMicros.toString(),
			proceedsUsdMicros: lot.proceedsUsdMicros.toString(),
			pnlUsdMicros: pnl.toString(),
			pnlPct: lot.costUsdMicros === 0n ? 0 : (Number(pnl) / Number(lot.costUsdMicros)) * 100,
			reason: record.reason,
			openedAt: lot.openedAt,
			closedAt: record.ts,
		});
	}
	return { open: [...lots.values()], closed };
}

export class KrakenLedger {
	private readonly log: JsonlLog<KrakenLedgerRecord>;

	constructor(filePath: string) {
		this.log = new JsonlLog(filePath, KrakenLedgerRecordSchema);
	}

	load(): { open: KrakenLot[]; closed: KrakenClosedTrade[]; warnings: string[] } {
		const { records, warnings } = this.log.load();
		return { ...rebuild(records), warnings };
	}

	appendFill(fill: KrakenFill): void {
		this.log.append({ kind: "fill", ...fill });
	}

	appendClose(record: Omit<KrakenCloseRecord, "kind">): void {
		this.log.append({ kind: "close", ...record });
	}

	reset(): void {
		this.log.reset();
	}
}
