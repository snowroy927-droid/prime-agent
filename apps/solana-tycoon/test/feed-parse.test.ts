import { describe, expect, it } from "vitest";
import { backoffDelay } from "../src/engine/feed/backoff";
import { isValidMint, parsePumpPortalMessage } from "../src/engine/feed/parse";

const MINT = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const CREATOR = "So11111111111111111111111111111111111111112";

describe("parsePumpPortalMessage", () => {
	it("reads a create message into a launch", () => {
		const raw = JSON.stringify({
			signature: "5sig",
			mint: MINT,
			traderPublicKey: CREATOR,
			txType: "create",
			initialBuy: 1000,
			marketCapSol: 28.7,
			name: "Zorp Coin",
			symbol: "ZORP",
			uri: "https://ipfs.io/ipfs/abc",
			bondingCurveKey: CREATOR,
			unknownField: true,
		});
		expect(parsePumpPortalMessage(raw, 1_234)).toEqual({
			kind: "launch",
			launch: {
				mint: MINT,
				name: "Zorp Coin",
				symbol: "ZORP",
				creator: CREATOR,
				signature: "5sig",
				uri: "https://ipfs.io/ipfs/abc",
				marketCapSol: 28.7,
				receivedAt: 1_234,
			},
		});
	});

	it("falls back to the symbol, then UNKNOWN, for a missing name", () => {
		const withSymbol = parsePumpPortalMessage(JSON.stringify({ txType: "create", mint: MINT, symbol: "ZP" }), 1);
		expect(withSymbol.kind === "launch" && withSymbol.launch.name).toBe("ZP");
		const bare = parsePumpPortalMessage(JSON.stringify({ txType: "create", mint: MINT }), 1);
		expect(bare.kind === "launch" && bare.launch).toMatchObject({
			name: "UNKNOWN",
			symbol: "UNKNOWN",
			creator: null,
			signature: null,
			uri: null,
			marketCapSol: null,
		});
	});

	it("ignores wrongly typed optional fields and trims long text", () => {
		const parsed = parsePumpPortalMessage(
			JSON.stringify({
				txType: "create",
				mint: MINT,
				name: `  ${"x".repeat(200)}  `,
				symbol: 42,
				marketCapSol: "big",
				traderPublicKey: "not-a-key",
			}),
			1,
		);
		expect(parsed.kind === "launch" && parsed.launch).toMatchObject({
			name: "x".repeat(64),
			symbol: "UNKNOWN",
			marketCapSol: null,
			creator: null,
		});
	});

	it("reads migrations", () => {
		expect(parsePumpPortalMessage(JSON.stringify({ txType: "migrate", mint: MINT }), 1)).toEqual({
			kind: "migration",
			mint: MINT,
		});
		expect(parsePumpPortalMessage(JSON.stringify({ txType: "migration", mint: MINT }), 1).kind).toBe("migration");
	});

	it("rejects invalid mints, non-JSON, and unknown shapes", () => {
		expect(parsePumpPortalMessage(JSON.stringify({ txType: "create", mint: "0OIl" }), 1).kind).toBe("invalid");
		expect(parsePumpPortalMessage(JSON.stringify({ txType: "create", mint: "abc" }), 1).kind).toBe("invalid");
		expect(parsePumpPortalMessage("not json", 1).kind).toBe("invalid");
		expect(parsePumpPortalMessage("[1,2]", 1).kind).toBe("invalid");
		expect(parsePumpPortalMessage(JSON.stringify({ txType: "buy", mint: MINT }), 1).kind).toBe("invalid");
	});

	it("recognises subscription acks", () => {
		expect(parsePumpPortalMessage('{"message":"Successfully subscribed to token creation events."}', 1)).toEqual({
			kind: "ack",
		});
	});

	it("validates mints as base58 that decodes to 32 bytes", () => {
		expect(isValidMint(MINT)).toBe(true);
		expect(isValidMint("11111111111111111111111111111111")).toBe(true);
		expect(isValidMint("abc")).toBe(false);
		expect(isValidMint(42)).toBe(false);
	});
});

describe("backoffDelay", () => {
	it("doubles from the base delay and caps at 30 seconds before jitter", () => {
		expect(backoffDelay(0, 0.5)).toBe(1_000);
		expect(backoffDelay(3, 0.5)).toBe(8_000);
		expect(backoffDelay(10, 0.5)).toBe(30_000);
		expect(backoffDelay(0, 0.5, 10)).toBe(10);
	});

	it("jitters between 0.8x and 1.2x", () => {
		expect(backoffDelay(1, 0)).toBe(1_600);
		expect(backoffDelay(1, 0.999_999)).toBeCloseTo(2_400, 0);
	});
});
