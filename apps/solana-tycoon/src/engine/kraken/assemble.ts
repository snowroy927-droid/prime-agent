import {
	applyKrakenSettingsPatch,
	DEFAULT_KRAKEN_SETTINGS,
	type KrakenEvent,
	type KrakenSettings,
} from "../../shared/kraken";
import type { Mode } from "../../shared/types";
import type { Clock } from "../clock";
import { RiskGuard } from "../risk/guard";
import { JsonSettingsStore } from "../settingsStore";
import { BarBook } from "./bars";
import { KRAKEN_RISK_COPY, KrakenDesk, krakenLimits } from "./desk";
import type { KrakenFeedLike } from "./feed";
import { KrakenLedger } from "./ledger";
import { PairUniverse } from "./pairs";
import { KrakenPaperExecutor } from "./paper";
import type { KrakenRestLike } from "./rest";

export interface KrakenDeskOptions {
	mode: Mode;
	synthetic: boolean;
	feed: KrakenFeedLike;
	rest: KrakenRestLike;
	clock: Clock;
	settingsPath: string;
	ledgerPath: string;
	emit: (event: KrakenEvent) => void;
	tzOffsetMin: () => number;
}

// Wires a paper Kraken desk around a market-data source: live (KrakenFeed + KrakenRest), replayed, or faked.
export function assembleKrakenDesk(o: KrakenDeskOptions): {
	desk: KrakenDesk;
	universe: PairUniverse;
	settings: JsonSettingsStore<KrakenSettings>;
} {
	const settings = new JsonSettingsStore(o.settingsPath, DEFAULT_KRAKEN_SETTINGS, applyKrakenSettingsPatch);
	const universe = new PairUniverse({ rest: o.rest, clock: o.clock, settings: () => settings.get() });
	let desk: KrakenDesk | null = null;
	const executor = new KrakenPaperExecutor({
		mode: o.mode,
		clock: o.clock,
		settings: () => settings.get(),
		universe,
		quote: (pair) => desk?.quote(pair) ?? null,
		halted: (pair) => desk?.isHalted(pair) ?? false,
	});
	desk = new KrakenDesk({
		mode: o.mode,
		synthetic: o.synthetic,
		feed: o.feed,
		rest: o.rest,
		universe,
		bars: new BarBook(),
		executor,
		ledger: new KrakenLedger(o.ledgerPath),
		settings,
		risk: new RiskGuard({
			clock: o.clock,
			limits: () => krakenLimits(settings.get()),
			copy: KRAKEN_RISK_COPY,
			tzOffsetMin: o.tzOffsetMin,
		}),
		clock: o.clock,
		emit: o.emit,
		tzOffsetMin: o.tzOffsetMin,
	});
	return { desk, universe, settings };
}
