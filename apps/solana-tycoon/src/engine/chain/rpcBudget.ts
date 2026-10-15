import type { Clock } from "../clock";

// Token bucket: refills continuously at maxPerSecond and holds at most one second of calls.
export class RpcBudget {
	private tokens: number;
	private last: number;

	constructor(
		private readonly maxPerSecond: number,
		private readonly clock: Clock,
	) {
		this.tokens = maxPerSecond;
		this.last = clock.now();
	}

	tryTake(cost = 1): boolean {
		const now = this.clock.now();
		this.tokens = Math.min(this.maxPerSecond, this.tokens + ((now - this.last) / 1000) * this.maxPerSecond);
		this.last = now;
		if (this.tokens < cost) return false;
		this.tokens -= cost;
		return true;
	}

	capacity(): number {
		return this.maxPerSecond;
	}
}
