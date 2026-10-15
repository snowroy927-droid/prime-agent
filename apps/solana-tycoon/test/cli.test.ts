import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/engine/cli";
import { readEnv } from "../src/engine/env";

describe("parseArgs", () => {
	it("defaults to a plain paper run", () => {
		expect(parseArgs([])).toEqual({
			demo: false,
			replayFile: null,
			record: false,
			speed: 1,
			port: null,
			staticDir: null,
			dataDir: null,
		});
	});

	it("reads every flag", () => {
		expect(
			parseArgs([
				"--demo",
				"--record",
				"--speed",
				"50",
				"--port",
				"0",
				"--static-dir",
				"/tmp/web",
				"--data-dir",
				"/tmp/data",
			]),
		).toEqual({
			demo: true,
			replayFile: null,
			record: true,
			speed: 50,
			port: 0,
			staticDir: "/tmp/web",
			dataDir: "/tmp/data",
		});
		expect(parseArgs(["--replay", "data/recordings/a.jsonl"]).replayFile).toBe("data/recordings/a.jsonl");
	});

	it("rejects unknown flags and bad values", () => {
		expect(() => parseArgs(["--live"])).toThrow("Unknown option: --live");
		expect(() => parseArgs(["--replay"])).toThrow("--replay needs a value");
		expect(() => parseArgs(["--speed", "0"])).toThrow("--speed must be a positive number");
		expect(() => parseArgs(["--port", "70000"])).toThrow("--port must be an integer from 0 to 65535");
		expect(() => parseArgs(["--demo", "--replay", "x.jsonl"])).toThrow("Use either --demo or --replay");
		expect(() => parseArgs(["--speed", "4"])).toThrow("--speed only applies to --demo and --replay");
	});
});

describe("readEnv", () => {
	it("treats the public endpoint as the public fallback even when it is set explicitly", () => {
		expect(readEnv({ RPC_URL: "https://api.mainnet-beta.solana.com" }).publicFallback).toBe(true);
		expect(readEnv({ RPC_URL: "https://api.mainnet-beta.solana.com/" }).publicFallback).toBe(true);
		expect(readEnv({ RPC_URL: "https://rpc.example" }).publicFallback).toBe(false);
	});

	it("falls back to the public RPC and derives the websocket URL", () => {
		expect(readEnv({})).toEqual({
			rpcUrl: "https://api.mainnet-beta.solana.com",
			rpcWsUrl: "wss://api.mainnet-beta.solana.com",
			mode: "paper",
			keypairPath: null,
			port: 7777,
			rpcMaxRps: 5,
			publicFallback: true,
		});
	});

	it("uses configured values", () => {
		expect(
			readEnv({
				RPC_URL: "http://localhost:8899",
				MODE: "live",
				KEYPAIR_PATH: "/keys/burner.json",
				PORT: "8080",
				RPC_MAX_RPS: "20",
			}),
		).toEqual({
			rpcUrl: "http://localhost:8899",
			rpcWsUrl: "ws://localhost:8899",
			mode: "live",
			keypairPath: "/keys/burner.json",
			port: 8080,
			rpcMaxRps: 20,
			publicFallback: false,
		});
		expect(readEnv({ RPC_URL: "https://rpc.example", RPC_WS_URL: "wss://ws.example" }).rpcWsUrl).toBe(
			"wss://ws.example",
		);
	});

	it("rejects invalid values with the key name", () => {
		expect(() => readEnv({ MODE: "yolo" })).toThrow("MODE must be paper or live");
		expect(() => readEnv({ PORT: "abc" })).toThrow("PORT must be an integer from 0 to 65535");
		expect(() => readEnv({ RPC_MAX_RPS: "-1" })).toThrow("RPC_MAX_RPS must be a positive number");
	});
});
