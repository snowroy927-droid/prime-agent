import { formatSol, lamportsToSol } from "../../shared/units";

export function solAmount(lamports: string | bigint, digits = 3): string {
	return lamportsToSol(lamports).toFixed(digits);
}

export function solSigned(lamports: string | bigint, digits = 4): string {
	return formatSol(lamports, digits);
}

export function pct(value: number | null): string {
	if (value === null) return "--";
	return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function age(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h`;
}

export function clockTime(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function price(value: number | undefined | null): string {
	if (value === undefined || value === null) return "--";
	if (value === 0) return "0";
	return value < 0.0001 ? value.toExponential(2) : value.toPrecision(3);
}
