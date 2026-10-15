import type { FeedEvent, LaunchFeed } from "../../src/engine/feed/types";
import type { FeedStatus, Launch } from "../../src/shared/types";

export class FakeFeed implements LaunchFeed {
	started = false;
	private readonly listeners = new Set<(event: FeedEvent) => void>();

	start(): void {
		this.started = true;
		this.emit({ type: "status", status: "live", dropped: 0, reconnectAt: null });
	}

	stop(): void {
		this.started = false;
	}

	on(listener: (event: FeedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	launch(launch: Launch): void {
		this.emit({ type: "launch", launch, raw: JSON.stringify({ txType: "create", ...launch }) });
	}

	migration(mint: string): void {
		this.emit({ type: "migration", mint });
	}

	status(status: FeedStatus, dropped = 0): void {
		this.emit({ type: "status", status, dropped, reconnectAt: null });
	}

	private emit(event: FeedEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}
}
