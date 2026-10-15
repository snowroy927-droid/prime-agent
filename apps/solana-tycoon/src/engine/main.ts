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
import { Engine } from "./core/engine";
import { TradingCore } from "./core/tradingCore";
import { readEnv } from "./env";
import { PumpPortalFeed } from "./feed/pumpportal";
import type { LaunchFeed } from "./feed/types";
import { assembleKrakenDesk } from "./kraken/assemble";
import type { KrakenDesk } from "./kraken/desk";
import { KrakenFeed } from "./kraken/feed";
import { KrakenLedger } from "./kraken/ledger";
import type { PairUniverse } from "./kraken/pairs";
import { ReplayKrakenSource } from "./kraken/replay";
import { fetchGet, KrakenRest } from "./kraken/rest";
import { Ledger } from "./ledger/ledger";
import { ReplayDriver } from "./replay/player";
import { Recorder } from "./replay/recorder";
import { type RecordingLine, readRecording } from "./replay/recording";
import { PUMP_RISK_COPY, pumpLimits, RiskGuard } from "./risk/guard";
import { LaunchHistory } from "./scout/launchHistory";
import { Scout } from "./scout/scout";
import { modeDefaultsFor, SettingsStore } from "./settingsStore";
import { PaperExecutor } from "./trader/paper";

const PUMPPORTAL_URL = "wss://pumpportal.fun/api/data";
const KRAKEN_WS_URL = "wss://ws.kraken.com/v2";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const tzOffsetMin = () => -new Date().getTimezoneOffset();

function krakenFiles(dataDir: string, mode: Mode) {
	return {
		settingsPath: join(dataDir, `settings-kraken-${mode}.json`),
		ledgerPath: join(dataDir, `ledger-kraken-${mode}.jsonl`),
	};
}

// Paper trading on Kraken's public market data: no API keys are read or needed.
function liveKrakenDesk(
	mode: Mode,
	dataDir: string,
	clock: Clock,
	bus: EngineBus,
	recorder: Recorder | null,
): KrakenDesk {
	const rest = new KrakenRest({ get: fetchGet, clock });
	const feed = new KrakenFeed({
		url: KRAKEN_WS_URL,
		clock,
		captureFile: join(dataDir, "fixtures", `kraken-raw-${stamp()}.jsonl`),
		captureLimit: 50,
	});
	if (recorder) {
		feed.onRaw((raw) => recorder.krakenRaw(raw));
		feed.on((event) => {
			if (event.type === "status") recorder.krakenFeedStatus(event.status);
		});
	}
	return assembleKrakenDesk({
		mode,
		synthetic: false,
		feed,
		rest: recorder ? recorder.wrapKrakenRest(rest) : rest,
		clock,
		...krakenFiles(dataDir, mode),
		emit: (event) => bus.emit(event),
		tzOffsetMin,
	}).desk;
}

// Demo and replay drive the desk from a recording on the engine clock and start from an empty Kraken ledger.
function replayKrakenDesk(
	mode: Mode,
	dataDir: string,
	clock: Clock,
	bus: EngineBus,
	lines: readonly RecordingLine[],
): KrakenDesk {
	let universe: PairUniverse | null = null;
	const source = new ReplayKrakenSource(lines, clock, () => universe);
	const files = krakenFiles(dataDir, mode);
	new KrakenLedger(files.ledgerPath).reset();
	const assembled = assembleKrakenDesk({
		mode,
		synthetic: source.synthetic,
		feed: source,
		rest: source,
		clock,
		...files,
		emit: (event) => bus.emit(event),
		tzOffsetMin,
	});
	universe = assembled.universe;
	return assembled.desk;
}

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
	let recorder: Recorder | null = null;
	let krakenLines: RecordingLine[] = [];

	if (replaying) {
		const file = mode === "demo" ? join(appRoot, "fixtures", "demo-session.jsonl") : resolve(cli.replayFile ?? "");
		if (!existsSync(file)) throw new Error(`Recording not found: ${file}`);
		const lines = readRecording(file);
		// The demo keeps its Kraken session in its own fixture; a --record recording holds both desks in one file.
		krakenLines = mode === "demo" ? readRecording(join(appRoot, "fixtures", "kraken-demo-session.jsonl")) : lines;
		const driver = new ReplayDriver(lines, clock);
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
			const active = new Recorder(join(dataDir, "recordings", `${stamp()}.jsonl`), clock);
			recorder = active;
			chain = active.wrapChain(chain);
			onRaw = (raw) => active.launchRaw(raw);
			portalFeed.on((event) => {
				if (event.type === "status") active.feedStatus(event.status);
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
		tzOffsetMin,
		onRaw,
	});
	let kraken: KrakenDesk | null = null;
	let krakenFailure: string | undefined;
	// A Kraken desk that cannot be built (for example, a corrupt settings file) shows OFFLINE; pump.fun runs anyway.
	try {
		if (env.kraken && !replaying) kraken = liveKrakenDesk(mode, dataDir, clock, bus, recorder);
		// A recording made before the Kraken desk existed replays pump.fun only.
		if (env.kraken && replaying && krakenLines.some((line) => line.kind.startsWith("kraken_"))) {
			kraken = replayKrakenDesk(mode, dataDir, clock, bus, krakenLines);
		}
	} catch (error) {
		krakenFailure = error instanceof Error ? error.message : String(error);
		console.error(`Kraken desk offline: ${krakenFailure}`);
	}
	const engine = new Engine(core, kraken, { bus, clock, krakenFailure });

	const bridge = new BridgeServer({
		port: cli.port ?? env.port,
		staticDir: resolve(cli.staticDir ?? join(appRoot, "dist", "web")),
		core: engine,
		bus,
		token: createSessionToken(),
		mode,
		synthetic,
	});

	await engine.start();
	const { url } = await bridge.listen();
	console.log(`SUPER C SNIPER  mode=${mode.toUpperCase()}  ${url}`);
	if (publicFallback) console.log("Warning: using the public Solana RPC; set RPC_URL for reliable data.");

	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		await bridge.close();
		await engine.stop();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
