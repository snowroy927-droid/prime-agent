import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mode } from "../shared/types";
import { BridgeServer, createSessionToken } from "./bridge/server";
import { EngineBus } from "./bus";
import { PumpChain } from "./chain/pumpChain";
import { RpcBudget } from "./chain/rpcBudget";
import { web3 } from "./chain/solana";
import type { ChainSource } from "./chain/types";
import { parseArgs } from "./cli";
import { type Clock, RealClock, ScaledClock } from "./clock";
import { TradingCore } from "./core/tradingCore";
import { readEnv } from "./env";
import { PumpPortalFeed } from "./feed/pumpportal";
import type { LaunchFeed } from "./feed/types";
import { Ledger } from "./ledger/ledger";
import { ReplayDriver } from "./replay/player";
import { Recorder } from "./replay/recorder";
import { readRecording } from "./replay/recording";
import { PUMP_RISK_COPY, pumpLimits, RiskGuard } from "./risk/guard";
import { LaunchHistory } from "./scout/launchHistory";
import { Scout } from "./scout/scout";
import { modeDefaultsFor, SettingsStore } from "./settingsStore";
import { PaperExecutor } from "./trader/paper";

const PUMPPORTAL_URL = "wss://pumpportal.fun/api/data";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function main(): Promise<void> {
	const envFile = join(appRoot, ".env");
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const cli = parseArgs(process.argv.slice(2));
	const env = readEnv(process.env);
	const dataDir = resolve(cli.dataDir ?? join(appRoot, "data"));

	const mode: Mode = cli.demo ? "demo" : cli.replayFile ? "replay" : env.mode;
	if (mode === "live") {
		console.error("Live mode arrives in Milestone 2. Set MODE=paper.");
		process.exit(1);
	}

	const replaying = mode === "demo" || mode === "replay";
	const clockRate = replaying ? cli.speed : 1;
	const clock: Clock = clockRate === 1 ? new RealClock() : new ScaledClock(new RealClock(), clockRate);
	const budget = new RpcBudget(env.rpcMaxRps, clock);
	const bus = new EngineBus();
	const ledger = new Ledger(join(dataDir, `ledger-${mode}.jsonl`));
	const settings = new SettingsStore(join(dataDir, `settings-${mode}.json`), modeDefaultsFor(mode));

	let feed: LaunchFeed;
	let chain: ChainSource;
	let synthetic = false;
	let history: LaunchHistory;
	let onRaw: ((raw: string) => void) | undefined;
	let publicFallback = false;

	if (replaying) {
		const file = mode === "demo" ? join(appRoot, "fixtures", "demo-session.jsonl") : resolve(cli.replayFile ?? "");
		if (!existsSync(file)) throw new Error(`Recording not found: ${file}`);
		const driver = new ReplayDriver(readRecording(file), clock);
		feed = driver.feed;
		chain = driver.chain;
		synthetic = driver.synthetic;
		history = new LaunchHistory(null, clock);
		ledger.reset();
	} else {
		publicFallback = env.publicFallback;
		const connection = new web3.Connection(env.rpcUrl, { wsEndpoint: env.rpcWsUrl, commitment: "confirmed" });
		chain = new PumpChain(connection, budget, clock);
		const portalFeed = new PumpPortalFeed({
			url: PUMPPORTAL_URL,
			clock,
			captureFile: join(dataDir, "fixtures", `pumpportal-raw-${stamp()}.jsonl`),
			captureLimit: 50,
		});
		feed = portalFeed;
		history = new LaunchHistory(join(dataDir, "launches.jsonl"), clock);
		if (cli.record) {
			const recorder = new Recorder(join(dataDir, "recordings", `${stamp()}.jsonl`), clock);
			chain = recorder.wrapChain(chain);
			onRaw = (raw) => recorder.launchRaw(raw);
			portalFeed.on((event) => {
				if (event.type === "status") recorder.feedStatus(event.status);
			});
		}
	}

	const risk = new RiskGuard({ clock, limits: () => pumpLimits(settings.get()), copy: PUMP_RISK_COPY });
	let core: TradingCore | null = null;
	const executor = new PaperExecutor({
		mode,
		chain,
		globals: () => {
			if (!core) throw new Error("Engine is starting");
			return core.globals();
		},
		clock,
		settings: () => settings.get(),
	});
	core = new TradingCore({
		mode,
		synthetic,
		feed,
		chain,
		executor,
		ledger,
		history,
		scout: new Scout({ chain, budget, history, clock, settings: () => settings.get() }),
		risk,
		budget,
		clock,
		bus,
		settings,
		publicRpcFallback: publicFallback,
		clockRate,
		tzOffsetMin: () => -new Date().getTimezoneOffset(),
		onRaw,
	});

	const bridge = new BridgeServer({
		port: cli.port ?? env.port,
		staticDir: resolve(cli.staticDir ?? join(appRoot, "dist", "web")),
		core,
		bus,
		token: createSessionToken(),
		mode,
		synthetic,
	});

	await core.start();
	const { url } = await bridge.listen();
	console.log(`SUPER C SNIPER  mode=${mode.toUpperCase()}  ${url}`);
	if (publicFallback) console.log("Warning: using the public Solana RPC; set RPC_URL for reliable data.");

	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		await bridge.close();
		await core.stop();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
