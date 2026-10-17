import BN from "bn.js";
import { web3 } from "./chain/solana";

interface PublicKeyLike {
	toBase58(): string;
	toBuffer(): Buffer;
}

// SDK packages can bundle their own copies of bn.js and web3.js, so match by shape too.
function isPublicKeyLike(value: object): value is PublicKeyLike {
	if (value instanceof web3.PublicKey) return true;
	const candidate = value as Partial<Record<keyof PublicKeyLike, unknown>>;
	return typeof candidate.toBase58 === "function" && typeof candidate.toBuffer === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export function toJsonSafe(value: unknown): unknown {
	if (typeof value === "bigint") return { $big: value.toString() };
	if (typeof value !== "object" || value === null) return value;
	if (BN.isBN(value)) return { $bn: value.toString() };
	if (isPublicKeyLike(value)) return { $pk: value.toBase58() };
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (!isPlainObject(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
}

export function fromJsonSafe(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(fromJsonSafe);
	if (!isPlainObject(value)) return value;
	const keys = Object.keys(value);
	if (keys.length === 1) {
		const tagged = value[keys[0]];
		if (typeof tagged === "string") {
			if (keys[0] === "$bn") return new BN(tagged);
			if (keys[0] === "$pk") return new web3.PublicKey(tagged);
			if (keys[0] === "$big") return BigInt(tagged);
		}
	}
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromJsonSafe(item)]));
}
