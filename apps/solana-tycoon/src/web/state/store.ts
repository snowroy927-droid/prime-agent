import { activeTier, comboCount, type TierId } from "../../shared/combo";
import { type UpgradeId, unlockedUpgrades } from "../../shared/progression";
import { type EngineEvent, type EngineSnapshot, PROTOCOL_VERSION } from "../../shared/protocol";
import type { ClosedTrade, LogLine, OrderUpdate, PriceTick } from "../../shared/types";
import { formatSol } from "../../shared/units";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface GameState {
	connection: ConnectionStatus;
	snapshot: EngineSnapshot | null;
	combo: number;
	tier: TierId;
	upgrades: UpgradeId[];
	selectedMint: string | null;
	log: LogLine[];
	now: number;
	prices: Record<string, PriceTick>;
	orders: Record<string, OrderUpdate>;
	sessionStart: number | null;
}

const RADAR_MAX = 50;
const CLOSES_MAX = 500;
const LOG_MAX = 200;

export function initialGameState(): GameState {
	return {
		connection: "connecting",
		snapshot: null,
		combo: 0,
		tier: "terminal",
		upgrades: [],
		selectedMint: null,
		log: [],
		now: 0,
		prices: {},
		orders: {},
		sessionStart: null,
	};
}

function withDerived(state: GameState, closes: readonly ClosedTrade[], now: number): GameState {
	return {
		...state,
		now,
		combo: comboCount(closes),
		tier: activeTier(closes, now),
		upgrades: unlockedUpgrades(closes),
	};
}

function addLog(state: GameState, line: LogLine): GameState {
	const log = [...state.log, line];
	return { ...state, log: log.length > LOG_MAX ? log.slice(-LOG_MAX) : log };
}

function symbolOf(snapshot: EngineSnapshot, mint: string): string {
	return snapshot.launches.find((entry) => entry.launch.mint === mint)?.launch.symbol ?? mint.slice(0, 4);
}

export function reduce(state: GameState, event: EngineEvent): GameState {
	if (event.type === "hello") {
		if (event.protocolVersion === PROTOCOL_VERSION) return state;
		return addLog(state, {
			level: "error",
			message: `Engine speaks protocol v${event.protocolVersion}, this page v${PROTOCOL_VERSION}. Restart the engine and reload.`,
			at: state.now,
		});
	}
	if (event.type === "snapshot") {
		const snapshot = event.snapshot;
		const now = Math.max(state.now, snapshot.serverTime);
		return withDerived(
			{ ...state, snapshot, sessionStart: state.sessionStart ?? snapshot.serverTime },
			snapshot.closes,
			now,
		);
	}
	if (event.type === "log") return addLog(state, event.line);
	const snapshot = state.snapshot;
	if (!snapshot) return state;

	switch (event.type) {
		case "launch": {
			const launches = [{ launch: event.launch, check: null }, ...snapshot.launches].slice(0, RADAR_MAX);
			return { ...state, snapshot: { ...snapshot, launches } };
		}
		case "check": {
			const launches = snapshot.launches.map((entry) =>
				entry.launch.mint === event.check.mint ? { ...entry, check: event.check } : entry,
			);
			const symbol = symbolOf(snapshot, event.check.mint);
			const next = { ...state, snapshot: { ...snapshot, launches } };
			if (event.check.verdict === "pending") return next;
			return addLog(next, {
				level: event.check.verdict === "approved" ? "info" : "warn",
				message: `VERA: ${symbol} ${event.check.verdict} - ${event.check.reason}`,
				at: event.check.checkedAt,
			});
		}
		case "price":
			return { ...state, prices: { ...state.prices, [event.tick.mint]: event.tick } };
		case "order": {
			const order = event.order;
			const next = { ...state, orders: { ...state.orders, [order.mint]: order } };
			if (order.status === "pending") return next;
			const verb = order.side === "buy" ? "bought" : "sold";
			return addLog(next, {
				level: order.status === "failed" ? "error" : "info",
				message:
					order.status === "failed"
						? `REX: ${order.symbol} ${order.side} failed - ${order.error ?? "unknown error"}`
						: `REX: ${verb} ${order.symbol}`,
				at: order.at,
			});
		}
		case "position": {
			const others = snapshot.positions.filter((position) => position.id !== event.position.id);
			const index = snapshot.positions.findIndex((position) => position.id === event.position.id);
			const positions =
				index === -1
					? [...others, event.position]
					: snapshot.positions.map((position) => (position.id === event.position.id ? event.position : position));
			return { ...state, snapshot: { ...snapshot, positions } };
		}
		case "close": {
			const closes = [...snapshot.closes, event.trade].slice(-CLOSES_MAX);
			const positions = snapshot.positions.filter((position) => position.id !== event.trade.positionId);
			const now = Math.max(state.now, event.trade.closedAt);
			const next = withDerived({ ...state, snapshot: { ...snapshot, closes, positions } }, closes, now);
			const won = BigInt(event.trade.pnlLamports) > 0n;
			return addLog(next, {
				level: won ? "info" : "warn",
				message: `GLOOP: ${event.trade.symbol} closed ${formatSol(event.trade.pnlLamports)} SOL (${event.trade.reason.replace("_", " ")})`,
				at: event.trade.closedAt,
			});
		}
		case "stats":
			return { ...state, snapshot: { ...snapshot, stats: event.stats, launchStats: event.launchStats } };
		case "feed":
			return {
				...state,
				snapshot: {
					...snapshot,
					feed: { status: event.status, dropped: event.dropped, reconnectAt: event.reconnectAt },
				},
			};
		case "risk":
			return { ...state, snapshot: { ...snapshot, risk: event.risk } };
		case "balance":
			return { ...state, snapshot: { ...snapshot, balanceLamports: event.lamports } };
		case "settings":
			return { ...state, snapshot: { ...snapshot, settings: event.settings } };
		case "pinned":
			return { ...state, snapshot: { ...snapshot, pinned: event.mints } };
	}
}

export function tick(state: GameState, now: number): GameState {
	const closes = state.snapshot?.closes ?? [];
	return { ...state, now, tier: activeTier(closes, now) };
}
