const MINUTE_MS = 60_000;

// One-minute candle; close in USD, volume in base units.
export interface Bar {
	begin: number;
	close: number;
	volume: number;
}

// The current minute plus the 60 before it, so the 60-minute change always has its reference bar.
const MAX_BARS = 61;

export class BarBook {
	private readonly bars = new Map<string, Bar[]>();

	constructor(private readonly maxBars = MAX_BARS) {}

	seed(wsname: string, bars: readonly Bar[]): void {
		for (const bar of bars) this.put(wsname, bar);
	}

	update(bar: Bar & { wsname: string }): void {
		this.put(bar.wsname, { begin: bar.begin, close: bar.close, volume: bar.volume });
	}

	// Percent change from the latest bar at or before `now - minutes` to the newest bar.
	change(wsname: string, minutes: number, now: number): number | null {
		const bars = this.bars.get(wsname);
		if (!bars || bars.length === 0) return null;
		const cutoff = now - minutes * MINUTE_MS;
		let reference: Bar | null = null;
		for (const bar of bars) if (bar.begin <= cutoff) reference = bar;
		if (!reference || reference.close <= 0) return null;
		return (bars[bars.length - 1].close / reference.close - 1) * 100;
	}

	usdVolume(wsname: string, minutes: number, now: number): number {
		const cutoff = now - minutes * MINUTE_MS;
		let total = 0;
		for (const bar of this.bars.get(wsname) ?? []) {
			if (bar.begin > cutoff && bar.begin <= now) total += bar.volume * bar.close;
		}
		return total;
	}

	minutesCovered(wsname: string, now: number): number {
		const oldest = this.bars.get(wsname)?.[0];
		return oldest ? Math.max(0, Math.floor((now - oldest.begin) / MINUTE_MS)) : 0;
	}

	private put(wsname: string, bar: Bar): void {
		const bars = this.bars.get(wsname) ?? [];
		const index = bars.findIndex((existing) => existing.begin >= bar.begin);
		if (index === -1) bars.push(bar);
		else if (bars[index].begin === bar.begin) bars[index] = bar;
		else bars.splice(index, 0, bar);
		if (bars.length > this.maxBars) bars.splice(0, bars.length - this.maxBars);
		this.bars.set(wsname, bars);
	}
}
