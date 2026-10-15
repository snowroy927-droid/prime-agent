export interface Clock {
	now(): number;
	sleep(ms: number): Promise<void>;
	every(ms: number, fn: () => void): () => void;
}

export class RealClock implements Clock {
	now(): number {
		return Date.now();
	}

	sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	every(ms: number, fn: () => void): () => void {
		const timer = setInterval(fn, ms);
		return () => clearInterval(timer);
	}
}

interface ManualTimer {
	at: number;
	seq: number;
	run: () => void;
	intervalMs: number | null;
	cancelled: boolean;
}

export class ManualClock implements Clock {
	private current: number;
	private seq = 0;
	private timers: ManualTimer[] = [];

	constructor(start = 0) {
		this.current = start;
	}

	now(): number {
		return this.current;
	}

	sleep(ms: number): Promise<void> {
		return new Promise((resolve) => {
			this.schedule(this.current + Math.max(0, ms), resolve, null);
		});
	}

	every(ms: number, fn: () => void): () => void {
		const timer = this.schedule(this.current + ms, fn, ms);
		return () => {
			timer.cancelled = true;
		};
	}

	async advance(ms: number): Promise<void> {
		const target = this.current + ms;
		await flushMicrotasks();
		for (;;) {
			const next = this.nextDue(target);
			if (!next) break;
			this.current = next.at;
			if (next.intervalMs === null) {
				next.cancelled = true;
			} else {
				next.at += next.intervalMs;
				next.seq = this.seq++;
			}
			next.run();
			await flushMicrotasks();
		}
		this.timers = this.timers.filter((timer) => !timer.cancelled);
		this.current = target;
	}

	private schedule(at: number, run: () => void, intervalMs: number | null): ManualTimer {
		const timer: ManualTimer = { at, seq: this.seq++, run, intervalMs, cancelled: false };
		this.timers.push(timer);
		return timer;
	}

	private nextDue(target: number): ManualTimer | undefined {
		let best: ManualTimer | undefined;
		for (const timer of this.timers) {
			if (timer.cancelled || timer.at > target) continue;
			if (!best || timer.at < best.at || (timer.at === best.at && timer.seq < best.seq)) best = timer;
		}
		return best;
	}
}

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
