import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { web3 } from "../src/engine/chain/solana";
import { fromJsonSafe, toJsonSafe } from "../src/engine/codec";

describe("codec", () => {
	it("round-trips BN, PublicKey, and bigint fields through JSON", () => {
		const decoded = {
			virtualTokenReserves: new BN("1073000000000000"),
			creator: new web3.PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
			lamports: 2_039_280n,
			complete: false,
			nested: [{ amount: new BN(42) }, null, "text", 7],
		};
		const wire = JSON.parse(JSON.stringify(toJsonSafe(decoded)));
		expect(wire.virtualTokenReserves).toEqual({ $bn: "1073000000000000" });
		expect(wire.creator).toEqual({ $pk: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" });
		expect(wire.lamports).toEqual({ $big: "2039280" });

		const back = fromJsonSafe(wire) as typeof decoded;
		expect(BN.isBN(back.virtualTokenReserves)).toBe(true);
		expect(back.virtualTokenReserves.toString()).toBe("1073000000000000");
		expect(back.creator).toBeInstanceOf(web3.PublicKey);
		expect(back.creator.equals(decoded.creator)).toBe(true);
		expect(back.lamports).toBe(2_039_280n);
		expect(back.complete).toBe(false);
		expect((back.nested[0] as { amount: BN }).amount.toNumber()).toBe(42);
		expect(back.nested.slice(1)).toEqual([null, "text", 7]);
	});

	it("recognises a PublicKey from another copy of web3.js by shape", () => {
		const foreign = { toBase58: () => "11111111111111111111111111111111", toBuffer: () => Buffer.alloc(32) };
		expect(toJsonSafe(foreign)).toEqual({ $pk: "11111111111111111111111111111111" });
	});
});
