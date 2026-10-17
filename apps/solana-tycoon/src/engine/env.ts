import { parsePort } from "./cli";

export interface EnvConfig {
	rpcUrl: string;
	rpcWsUrl: string;
	mode: "paper" | "live";
	keypairPath: string | null;
	port: number;
	rpcMaxRps: number;
	publicFallback: boolean;
	kraken: boolean;
}

export const PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com";

const value = (env: Record<string, string | undefined>, key: string): string | null => {
	const raw = env[key]?.trim();
	return raw ? raw : null;
};

export function readEnv(env: Record<string, string | undefined>): EnvConfig {
	const configuredRpc = value(env, "RPC_URL");
	const rpcUrl = configuredRpc ?? PUBLIC_RPC_URL;
	const mode = value(env, "MODE") ?? "paper";
	if (mode !== "paper" && mode !== "live") throw new Error("MODE must be paper or live");
	const rps = Number(value(env, "RPC_MAX_RPS") ?? "5");
	if (!Number.isFinite(rps) || rps <= 0) throw new Error("RPC_MAX_RPS must be a positive number");
	return {
		rpcUrl,
		rpcWsUrl: value(env, "RPC_WS_URL") ?? rpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:"),
		mode,
		keypairPath: value(env, "KEYPAIR_PATH"),
		port: parsePort(value(env, "PORT") ?? "7777", "PORT"),
		rpcMaxRps: rps,
		publicFallback: configuredRpc === null || configuredRpc.replace(/\/+$/, "") === PUBLIC_RPC_URL,
		kraken: value(env, "KRAKEN")?.toLowerCase() !== "off",
	};
}
