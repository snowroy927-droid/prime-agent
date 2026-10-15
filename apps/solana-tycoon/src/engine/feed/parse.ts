import type { Launch } from "../../shared/types";
import { web3 } from "../chain/solana";

export type ParsedFeedMessage =
	| { kind: "launch"; launch: Launch }
	| { kind: "migration"; mint: string }
	| { kind: "ack" }
	| { kind: "invalid" };

const MAX_TEXT = 64;

export function isValidMint(value: unknown): value is string {
	if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
	try {
		new web3.PublicKey(value);
		return true;
	} catch {
		return false;
	}
}

function text(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().slice(0, MAX_TEXT);
	return trimmed === "" ? null : trimmed;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

export function parsePumpPortalMessage(raw: string, receivedAt: number): ParsedFeedMessage {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { kind: "invalid" };
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return { kind: "invalid" };
	const message = data as Record<string, unknown>;

	if (message.mint === undefined && typeof message.message === "string") return { kind: "ack" };
	if (!isValidMint(message.mint)) return { kind: "invalid" };

	if (message.txType === "migrate" || message.txType === "migration") return { kind: "migration", mint: message.mint };
	if (message.txType !== "create") return { kind: "invalid" };

	const symbol = text(message.symbol) ?? "UNKNOWN";
	return {
		kind: "launch",
		launch: {
			mint: message.mint,
			name: text(message.name) ?? symbol,
			symbol,
			creator: isValidMint(message.traderPublicKey) ? message.traderPublicKey : null,
			signature: optionalString(message.signature),
			uri: optionalString(message.uri),
			marketCapSol:
				typeof message.marketCapSol === "number" && Number.isFinite(message.marketCapSol)
					? message.marketCapSol
					: null,
			receivedAt,
		},
	};
}
