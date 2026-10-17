import type { KrakenPair, KrakenSettings } from "../../shared/kraken";

export const USD_MICROS = 1_000_000n;
const BPS = 10_000n;
const DECIMAL = /^(-?)(\d+\.?\d*|\.\d+)(?:[eE]([-+]?\d+))?$/;

// Kraken sends tiny meme-coin prices as numbers that JavaScript prints in exponent form (1.234e-8).
export function decimalText(value: number | string): string {
	if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
	const text = String(value).trim();
	const match = DECIMAL.exec(text);
	if (!match) throw new Error(`Not a decimal: ${text}`);
	const [, sign, mantissa, exponentText] = match;
	const point = mantissa.indexOf(".");
	const digits = mantissa.replace(".", "");
	const shifted = (point === -1 ? mantissa.length : point) + Number(exponentText ?? 0);
	let whole: string;
	let fraction: string;
	if (shifted <= 0) {
		whole = "0";
		fraction = "0".repeat(-shifted) + digits;
	} else if (shifted >= digits.length) {
		whole = digits + "0".repeat(shifted - digits.length);
		fraction = "";
	} else {
		whole = digits.slice(0, shifted);
		fraction = digits.slice(shifted);
	}
	whole = whole.replace(/^0+(?=\d)/, "");
	fraction = fraction.replace(/0+$/, "");
	const body = fraction ? `${whole}.${fraction}` : whole;
	return sign && /[1-9]/.test(body) ? `-${body}` : body;
}

export function toScaled(value: number | string, decimals: number): bigint {
	const text = decimalText(value);
	const negative = text.startsWith("-");
	const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
	const scaled = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
	return negative ? -scaled : scaled;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
const feeBps = (paper: KrakenSettings["paper"]): bigint => BigInt(Math.round(paper.takerFeePct * 100));

// Rounding always favours caution: lots and proceeds round down, cost and fees round up.
export function quoteBuy(
	budgetUsdMicros: bigint,
	ask: bigint,
	pair: KrakenPair,
	paper: KrakenSettings["paper"],
): { ok: true; lots: bigint; notionalUsdMicros: bigint; feesUsdMicros: bigint } | { ok: false; error: string } {
	if (ask <= 0n) return { ok: false, error: `No price for ${pair.symbol}` };
	const scale = 10n ** BigInt(pair.priceDecimals + pair.lotDecimals);
	const slip = BPS + BigInt(paper.extraSlippageBps);
	const lots = (budgetUsdMicros * scale * BPS) / (ask * slip * USD_MICROS);
	if (lots <= 0n) return { ok: false, error: "Buy size below one lot" };
	const notionalUsdMicros = ceilDiv(lots * ask * slip * USD_MICROS, scale * BPS);
	if (pair.ordermin !== null && lots < toScaled(pair.ordermin, pair.lotDecimals)) {
		return { ok: false, error: "Below Kraken minimum order" };
	}
	if (pair.costmin !== null && notionalUsdMicros < toScaled(pair.costmin, 6)) {
		return { ok: false, error: "Below Kraken minimum cost" };
	}
	return { ok: true, lots, notionalUsdMicros, feesUsdMicros: ceilDiv(notionalUsdMicros * feeBps(paper), BPS) };
}

export function quoteSell(
	lots: bigint,
	bid: bigint,
	pair: KrakenPair,
	paper: KrakenSettings["paper"],
): { ok: true; proceedsUsdMicros: bigint; feesUsdMicros: bigint } | { ok: false; error: string } {
	if (bid <= 0n) return { ok: false, error: `No price for ${pair.symbol}` };
	if (lots <= 0n) return { ok: false, error: "Nothing to sell" };
	const scale = 10n ** BigInt(pair.priceDecimals + pair.lotDecimals);
	const gross = (lots * bid * (BPS - BigInt(paper.extraSlippageBps)) * USD_MICROS) / (scale * BPS);
	const feesUsdMicros = ceilDiv(gross * feeBps(paper), BPS);
	return { ok: true, proceedsUsdMicros: gross - feesUsdMicros, feesUsdMicros };
}
