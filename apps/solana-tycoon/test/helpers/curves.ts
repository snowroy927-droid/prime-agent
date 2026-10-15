import type { BondingCurve, Global } from "@pump-fun/pump-sdk";
import type { GlobalConfig, Pool } from "@pump-fun/pump-swap-sdk";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { pump, splToken, swap, web3 } from "../../src/engine/chain/solana";

type IdlFieldType =
	| string
	| { vec: IdlFieldType }
	| { array: [IdlFieldType, number] }
	| { option: IdlFieldType }
	| { defined: { name: string } };

interface IdlTypeDef {
	name: string;
	type:
		| { kind: "struct"; fields?: ({ name: string; type: IdlFieldType } | IdlFieldType)[] }
		| { kind: "enum"; variants: { name: string }[] };
}

interface AccountLayout {
	discriminator: number[];
	layout: { encode(value: unknown, buffer: Buffer): number };
}

interface ProgramLike {
	idl: { types?: unknown };
	coder: { accounts: { accountLayouts: Map<string, AccountLayout> } };
}

const offline = new web3.Connection("http://127.0.0.1:8899");
export const pumpProgram = pump.getPumpProgram(offline) as unknown as ProgramLike;
export const ammProgram = swap.getPumpAmmProgram(offline) as unknown as ProgramLike;

function typeDefs(program: ProgramLike): IdlTypeDef[] {
	return (program.idl.types ?? []) as IdlTypeDef[];
}

function defaultFor(program: ProgramLike, type: IdlFieldType): unknown {
	if (typeof type === "string") {
		if (type === "bool") return false;
		if (type === "pubkey") return web3.PublicKey.default;
		if (type === "string") return "";
		if (type === "u64" || type === "i64" || type === "u128" || type === "i128") return new BN(0);
		return 0;
	}
	if ("vec" in type) return [];
	if ("option" in type) return null;
	if ("array" in type) return Array.from({ length: type.array[1] }, () => defaultFor(program, type.array[0]));
	return idlDefault(program, type.defined.name);
}

// Builds a value with every field of an IDL type at its zero value, so fixtures only set what a test needs.
export function idlDefault(program: ProgramLike, name: string): unknown {
	const def = typeDefs(program).find((t) => t.name === name);
	if (!def) throw new Error(`IDL type ${name} not found`);
	if (def.type.kind === "enum") return { [def.type.variants[0].name]: {} };
	const fields = def.type.fields ?? [];
	if (fields.every((field) => typeof field === "object" && field !== null && "name" in field)) {
		return Object.fromEntries(
			(fields as { name: string; type: IdlFieldType }[]).map((field) => [
				field.name,
				defaultFor(program, field.type),
			]),
		);
	}
	return (fields as IdlFieldType[]).map((field) => defaultFor(program, field));
}

// Anchor 0.31's coder.accounts.encode writes into a fixed 1000-byte buffer, too small for pump's
// 1088-byte Global, so encode through the same account layout into a larger one.
function encodeAccount(program: ProgramLike, name: string, value: unknown): Buffer {
	const entry = program.coder.accounts.accountLayouts.get(name);
	if (!entry) throw new Error(`IDL account ${name} not found`);
	const buffer = Buffer.alloc(16_384);
	const length = entry.layout.encode(value, buffer);
	return Buffer.concat([Buffer.from(entry.discriminator), buffer.subarray(0, length)]);
}

export function accountInfo(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
	return { data, owner, executable: false, lamports: 1_000_000_000, rentEpoch: 0 };
}

export function fixtureGlobal(): Global {
	return {
		...(idlDefault(pumpProgram, "global") as Global),
		initialized: true,
		initialVirtualTokenReserves: new BN("1073000000000000"),
		initialVirtualSolReserves: new BN("30000000000"),
		initialRealTokenReserves: new BN("793100000000000"),
		tokenTotalSupply: new BN("1000000000000000"),
		feeBasisPoints: new BN(95),
		creatorFeeBasisPoints: new BN(5),
		initialVirtualQuoteReserves: new BN("30000000000"),
	};
}

export function fixtureCurve(overrides: Partial<BondingCurve> = {}): BondingCurve {
	return { ...pump.newBondingCurve(fixtureGlobal()), creator: web3.Keypair.generate().publicKey, ...overrides };
}

export function encodeCurve(curve: BondingCurve): AccountInfo<Buffer> {
	return accountInfo(encodeAccount(pumpProgram, "bondingCurve", curve), pump.PUMP_PROGRAM_ID);
}

export function encodeGlobal(global: Global): AccountInfo<Buffer> {
	return accountInfo(encodeAccount(pumpProgram, "global", global), pump.PUMP_PROGRAM_ID);
}

export function mintAccount(owner: PublicKey, supply = 1_000_000_000_000_000n): AccountInfo<Buffer> {
	const data = Buffer.alloc(splToken.MINT_SIZE);
	splToken.MintLayout.encode(
		{
			mintAuthorityOption: 0,
			mintAuthority: web3.PublicKey.default,
			supply,
			decimals: 6,
			isInitialized: true,
			freezeAuthorityOption: 0,
			freezeAuthority: web3.PublicKey.default,
		},
		data,
	);
	return accountInfo(data, owner);
}

export function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint): AccountInfo<Buffer> {
	const data = Buffer.alloc(splToken.ACCOUNT_SIZE);
	splToken.AccountLayout.encode(
		{
			mint,
			owner,
			amount,
			delegateOption: 0,
			delegate: web3.PublicKey.default,
			state: splToken.AccountState.Initialized,
			isNativeOption: 0,
			isNative: 0n,
			delegatedAmount: 0n,
			closeAuthorityOption: 0,
			closeAuthority: web3.PublicKey.default,
		},
		data,
	);
	return accountInfo(data, splToken.TOKEN_PROGRAM_ID);
}

export function fixturePool(mint: PublicKey): Pool {
	return {
		...(idlDefault(ammProgram, "pool") as Pool),
		baseMint: mint,
		quoteMint: splToken.NATIVE_MINT,
		creator: web3.Keypair.generate().publicKey,
		coinCreator: web3.Keypair.generate().publicKey,
		poolBaseTokenAccount: web3.Keypair.generate().publicKey,
		poolQuoteTokenAccount: web3.Keypair.generate().publicKey,
	};
}

export function encodePool(pool: Pool): AccountInfo<Buffer> {
	return accountInfo(encodeAccount(ammProgram, "pool", pool), swap.PUMP_AMM_PROGRAM_ID);
}

export function encodeGlobalConfig(): AccountInfo<Buffer> {
	const config = idlDefault(ammProgram, "globalConfig") as GlobalConfig;
	return accountInfo(encodeAccount(ammProgram, "globalConfig", config), swap.PUMP_AMM_PROGRAM_ID);
}
