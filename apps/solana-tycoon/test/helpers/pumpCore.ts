import { join } from "node:path";
import type { BondingCurve } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import type { EngineBus } from "../../src/engine/bus";
import { RpcBudget } from "../../src/engine/chain/rpcBudget";
import type { ManualClock } from "../../src/engine/clock";
import { TradingCore } from "../../src/engine/core/tradingCore";
import { Ledger } from "../../src/engine/ledger/ledger";
import { PUMP_RISK_COPY, pumpLimits, RiskGuard } from "../../src/engine/risk/guard";
import { LaunchHistory } from "../../src/engine/scout/launchHistory";
import { Scout } from "../../src/engine/scout/scout";
import { SettingsStore } from "../../src/engine/settingsStore";
import { PaperExecutor } from "../../src/engine/trader/paper";
import { fixtureCurve } from "./curves";
import { FakeChain } from "./fakeChain";
import { FakeFeed } from "./fakeFeed";

const SUPPLY = 1_000_000_000_000_000n;

export interface PumpRig {
	clock: ManualClock;
	chain: FakeChain;
	feed: FakeFeed;
	ledgerPath: string;
}

// A paper TradingCore on fakes, not yet started.
export function buildPumpCore(opts: {
	dir: string;
	clock: ManualClock;
	bus: EngineBus;
	budgetPerSec?: number;
	prepare?: (rig: PumpRig) => void;
}): PumpRig & { core: TradingCore } {
	const { clock, bus } = opts;
	const budget = new RpcBudget(opts.budgetPerSec ?? 1_000, clock);
	const chain = new FakeChain(clock, budget);
	const feed = new FakeFeed();
	const ledgerPath = join(opts.dir, "ledger.jsonl");
	opts.prepare?.({ clock, chain, feed, ledgerPath });
	const settings = new SettingsStore(join(opts.dir, "settings.json"), {});
	const history = new LaunchHistory(null, clock);
	let core: TradingCore | null = null;
	const executor = new PaperExecutor({
		mode: "paper",
		chain,
		globals: () => {
			if (!core) throw new Error("core not constructed");
			return core.globals();
		},
		clock,
		settings: () => settings.get(),
	});
	core = new TradingCore({
		mode: "paper",
		synthetic: false,
		feed,
		chain,
		executor,
		ledger: new Ledger(ledgerPath),
		history,
		scout: new Scout({ chain, budget, history, clock, settings: () => settings.get() }),
		risk: new RiskGuard({
			clock,
			limits: () => pumpLimits(settings.get()),
			copy: PUMP_RISK_COPY,
			tzOffsetMin: () => 0,
		}),
		budget,
		clock,
		bus,
		settings,
		publicRpcFallback: false,
		tzOffsetMin: () => 0,
	});
	return { core, clock, chain, feed, ledgerPath };
}

export function healthyCoin(h: { chain: FakeChain }, mint: string, holders = 12): BondingCurve {
	const curve = fixtureCurve({ realQuoteReserves: new BN(1_500_000_000) });
	h.chain.setCurve(mint, curve);
	h.chain.setHolders(mint, {
		supply: SUPPLY,
		curveAccount: "curve",
		holders: Array.from({ length: holders }, (_, i) => ({ account: `h${i}`, amount: SUPPLY / 100n })),
	});
	return curve;
}
