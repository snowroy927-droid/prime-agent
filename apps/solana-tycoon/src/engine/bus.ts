import type { EngineEvent } from "../shared/protocol";

type Listener = (event: EngineEvent) => void;

export class EngineBus {
	private readonly listeners = new Set<Listener>();

	emit(event: EngineEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				console.error("EngineBus listener failed:", error);
			}
		}
	}

	on(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
