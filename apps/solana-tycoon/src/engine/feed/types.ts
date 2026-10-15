import type { FeedStatus, Launch } from "../../shared/types";

export type FeedEvent =
	| { type: "launch"; launch: Launch; raw: string }
	| { type: "migration"; mint: string }
	| { type: "status"; status: FeedStatus; dropped: number; reconnectAt: number | null };

export interface LaunchFeed {
	start(): void;
	stop(): void;
	on(listener: (event: FeedEvent) => void): () => void;
}
