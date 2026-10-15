import type { Pool } from "@pump-fun/pump-swap-sdk";
import type { RawMint } from "@solana/spl-token";
import type { AccountInfo } from "@solana/web3.js";
import { splToken, swap } from "./solana";

export function decodePool(info: AccountInfo<Buffer>): Pool {
	return swap.PUMP_AMM_SDK.decodePool(info);
}

export function decodeMint(info: AccountInfo<Buffer>): RawMint {
	return splToken.MintLayout.decode(info.data.subarray(0, splToken.MINT_SIZE));
}

// The amount field sits in the base layout shared by SPL Token and Token-2022 accounts.
export function tokenAccountAmount(info: AccountInfo<Buffer>): bigint {
	return splToken.AccountLayout.decode(info.data.subarray(0, splToken.ACCOUNT_SIZE)).amount;
}
