import {
	DEFAULT_KRAKEN_SETTINGS,
	type KrakenClosedTrade,
	type KrakenPosition,
	type KrakenSnapshot,
	krakenOutcome,
	type Mover,
} from "../../src/shared/kraken";
import { computeStatsOf } from "../../src/shared/stats";

export function mover(over: Partial<Mover> = {}): Mover {
	return {
		pair: "MOONUSD",
		symbol: "MOON",
		last: "1.06",
		bid: "1.059",
		ask: "1.061",
		change5m: 1.2,
		change15m: 6,
		change60m: 7.5,
		volumeUsd24h: 1_200_000,
		spreadPct: 0.19,
		status: "eligible",
		reason: "All rule checks passed",
		...over,
	};
}

export function krakenTrade(
	pnlUsdMicros: bigint,
	closedAt: number,
	over: Partial<KrakenClosedTrade> = {},
): KrakenClosedTrade {
	return {
		positionId: `k${closedAt}`,
		mode: "paper",
		pair: "MOONUSD",
		symbol: "MOON",
		costUsdMicros: "50400000",
		proceedsUsdMicros: (50_400_000n + pnlUsdMicros).toString(),
		pnlUsdMicros: pnlUsdMicros.toString(),
		pnlPct: Number(pnlUsdMicros) / 504_000,
		reason: pnlUsdMicros >= 0n ? "take_profit" : "stop_loss",
		openedAt: closedAt - 60_000,
		closedAt,
		...over,
	};
}

export function krakenPosition(over: Partial<KrakenPosition> = {}): KrakenPosition {
	return {
		id: "kp1",
		mode: "paper",
		pair: "MOONUSD",
		symbol: "MOON",
		openedAt: 0,
		costUsdMicros: "50400000",
		proceedsUsdMicros: "0",
		lots: "4700",
		valueUsdMicros: "52000000",
		pnlPct: 3.2,
		peakPnlPct: 3.2,
		price: "1.1",
		priceAt: 0,
		stale: false,
		halted: false,
		pendingOrder: false,
		...over,
	};
}

export function krakenSnapshot(over: Partial<KrakenSnapshot> = {}): KrakenSnapshot {
	const closes = over.closes ?? [];
	return {
		error: null,
		feed: { status: "live", dropped: 0, reconnectAt: null },
		movers: [mover()],
		positions: [],
		closes,
		stats: computeStatsOf(closes.map(krakenOutcome), 0, 1_000_000),
		scanStats: { moversPerHour: Array(24).fill(0), skipReasons: [] },
		risk: {
			auto: true,
			paused: false,
			pausedReason: null,
			tiltLosses: 0,
			tiltUntil: null,
			dailyPnl: "0",
			dailyCapUntil: null,
		},
		settings: DEFAULT_KRAKEN_SETTINGS,
		pinned: [],
		balanceUsdMicros: "1000000000",
		solUsd: null,
		...over,
	};
}
