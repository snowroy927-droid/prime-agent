export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BASE_FEE_LAMPORTS = 5_000n;
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
export const TOKEN_DECIMALS = 6;

export function solToLamports(sol: number): bigint {
	return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}

export function lamportsToSol(lamports: bigint | string): number {
	return Number(BigInt(lamports)) / Number(LAMPORTS_PER_SOL);
}

export function formatSol(lamports: bigint | string, digits = 4): string {
	const value = BigInt(lamports);
	const text = Math.abs(lamportsToSol(value)).toFixed(digits);
	if (value === 0n) return text;
	return `${value > 0n ? "+" : "-"}${text}`;
}

export function pnlPct(cost: bigint, returned: bigint): number {
	if (cost === 0n) return 0;
	return (Number(returned - cost) / Number(cost)) * 100;
}

export function haircut(amount: bigint, bps: number): bigint {
	return (amount * BigInt(10_000 - bps)) / 10_000n;
}
