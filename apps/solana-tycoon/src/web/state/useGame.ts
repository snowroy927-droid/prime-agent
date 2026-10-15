import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Ack, CommandInput, EngineEvent } from "../../shared/protocol";
import { BridgeClient } from "../net/bridgeClient";
import { type ConnectionStatus, type GameState, initialGameState, reduce, tick } from "./store";

// Holds game state outside React so the HUD and the canvas renderer read the same source.
// React re-renders at most once per animation frame however many events arrive.
export class GameStore {
	private state: GameState = tick(initialGameState(), Date.now());
	private readonly listeners = new Set<() => void>();
	private readonly eventListeners = new Set<(event: EngineEvent, state: GameState) => void>();
	private frame: number | null = null;

	getState = (): GameState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	onEvent(listener: (event: EngineEvent, state: GameState) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	dispatch(event: EngineEvent): void {
		this.state = reduce(this.state, event);
		for (const listener of [...this.eventListeners]) listener(event, this.state);
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

	tick(now: number): void {
		this.state = tick(this.state, now);
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
