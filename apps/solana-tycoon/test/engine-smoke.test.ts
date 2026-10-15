import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "../src/shared/protocol";

const appRoot = join(import.meta.dirname, "..");
let child: ChildProcess | null = null;
let dir = "";

afterEach(() => {
	if (child && child.exitCode === null) child.kill("SIGKILL");
	child = null;
	if (dir) rmSync(dir, { recursive: true, force: true });
});

function waitForUrl(proc: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(() => reject(new Error(`engine did not start:\n${output}`)), 30_000);
		const onData = (chunk: Buffer) => {
			output += chunk.toString();
			const match = output.match(/SUPER C SNIPER {2}mode=DEMO {2}(http:\/\/127\.0\.0\.1:\d+)/);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		};
		proc.stdout?.on("data", onData);
		proc.stderr?.on("data", onData);
		proc.on("exit", (code) => reject(new Error(`engine exited with ${code}:\n${output}`)));
	});
}

describe("engine smoke", () => {
	it("serves the demo over the bridge and stops on SIGINT", async () => {
		dir = mkdtempSync(join(tmpdir(), "smoke-"));
		const staticDir = join(dir, "web");
		mkdirSync(staticDir);
		writeFileSync(join(staticDir, "index.html"), '<meta name="sniper-token" content="%SNIPER_TOKEN%">');
		child = spawn(
			process.execPath,
			[
				"--import",
				"tsx",
				"src/engine/main.ts",
				"--demo",
				"--speed",
				"50",
				"--port",
				"0",
				"--static-dir",
				staticDir,
				"--data-dir",
				join(dir, "data"),
			],
			{ cwd: appRoot, env: { ...process.env, RPC_URL: "", MODE: "paper" } },
		);
		const url = await waitForUrl(child);

		const html = await (await fetch(url)).text();
		const token = html.match(/content="([A-Za-z0-9_-]+)"/)?.[1] ?? "";
		expect(token).toHaveLength(32);

		const hello = await new Promise<ServerMessage>((resolve, reject) => {
			const ws = new WebSocket(`${url.replace("http", "ws")}/ws?token=${token}`, { headers: { Origin: url } });
			ws.on("message", (data) => {
				resolve(JSON.parse(data.toString()) as ServerMessage);
				ws.close();
			});
			ws.on("error", reject);
		});
		expect(hello).toEqual({ type: "hello", protocolVersion: 1, mode: "demo", synthetic: true });

		const exited = new Promise<number | null>((resolve) => child?.on("exit", (code) => resolve(code)));
		child.kill("SIGINT");
		expect(await exited).toBe(0);
	}, 60_000);
});
