import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Ack, CommandInput, EngineEvent } from "../../shared/protocol";
import { BridgeClient } from "../net/bridgeClient";
import {
	type ConnectionStatus,
	type DeskId,
	type GameState,
	initialGameState,
	reduce,
	type ServerClock,
	serverNow,
	tick,
	withDesk,
} from "./store";

const DESK_KEY = "super-c-sniper.desk";

function loadDesk(): DeskId {
	try {
		return localStorage.getItem(DESK_KEY) === "kraken" ? "kraken" : "pump";
	} catch {
		return "pump";
	}
}

// Holds game state outside React so the HUD and the canvas renderer read the same source.
// React re-renders at most once per animation frame however many events arrive.
export class GameStore {
	private state: GameState = withDesk(tick(initialGameState(), Date.now()), loadDesk());
	private readonly listeners = new Set<() => void>();
	private readonly eventListeners = new Set<(event: EngineEvent, next: GameState, prev: GameState) => void>();
	private frame: number | null = null;
	private clock: ServerClock | null = null;

	getState = (): GameState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	onEvent(listener: (event: EngineEvent, next: GameState, prev: GameState) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	dispatch(event: EngineEvent): void {
		if (event.type === "snapshot") {
			this.clock = { server: event.snapshot.serverTime, local: Date.now(), rate: event.snapshot.clockRate };
		}
		const prev = this.state;
		this.state = reduce(prev, event);
		for (const listener of [...this.eventListeners]) listener(event, this.state, prev);
		this.schedule();
	}

	setConnection(connection: ConnectionStatus): void {
		this.state = { ...this.state, connection };
		this.schedule();
	}

	select(selectedMint: string | null): void {
		this.state = { ...this.state, selectedMint };
		this.schedule();
	}

	selectPair(selectedPair: string | null): void {
		this.state = { ...this.state, selectedPair };
		this.schedule();
	}

	// The desk choice is remembered in this browser.
	selectDesk(desk: DeskId): void {
		this.state = withDesk(this.state, desk);
		try {
			localStorage.setItem(DESK_KEY, desk);
		} catch {
			// Storage unavailable: the choice lasts for this page only.
		}
		this.schedule();
	}

	// Advances the page's clock to the engine's current time, estimated from wall-clock time.
	tick(local: number): void {
		this.state = tick(this.state, serverNow(this.clock, local));
		this.schedule();
	}

	private schedule(): void {
		if (this.frame !== null) return;
		const flush = () => {
			this.frame = null;
			for (const listener of [...this.listeners]) listener();
		};
		this.frame =
			typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : Number(setTimeout(flush, 16));
	}
}

export interface Game {
	store: GameStore;
	client: BridgeClient;
	state: GameState;
	send: (command: CommandInput) => Promise<Ack>;
}

export function useGame(url: string, token: string): Game {
	const { store, client } = useMemo(
		() => ({ store: new GameStore(), client: new BridgeClient(url, token) }),
		[url, token],
	);
	useEffect(() => {
		const offEvent = client.onEvent((event) => store.dispatch(event));
		const offStatus = client.onStatus((status) => store.setConnection(status));
		client.connect();
		const timer = setInterval(() => store.tick(Date.now()), 1_000);
		return () => {
			offEvent();
			offStatus();
			clearInterval(timer);
			client.close();
		};
	}, [client, store]);
	const state = useSyncExternalStore(store.subscribe, store.getState);
	return { store, client, state, send: (command) => client.send(command) };
}
