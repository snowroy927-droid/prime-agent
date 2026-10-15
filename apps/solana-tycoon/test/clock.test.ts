import { describe, expect, it } from "vitest";
import { ManualClock, RealClock } from "../src/engine/clock";

describe("ManualClock", () => {
	it("resolves sleep only once time is advanced past it", async () => {
		const clock = new ManualClock(1_000);
		let resolved = false;
		void clock.sleep(800).then(() => {
			resolved = true;
		});
		await clock.advance(799);
		expect(resolved).toBe(false);
		await clock.advance(1);
		expect(resolved).toBe(true);
		expect(clock.now()).toBe(1_800);
	});

	it("fires intervals on schedule and stops after cancel", async () => {
		const clock = new ManualClock();
		let ticks = 0;
		const stop = clock.every(1_000, () => {
			ticks += 1;
		});
		await clock.advance(3_000);
		expect(ticks).toBe(3);
		stop();
		await clock.advance(5_000);
		expect(ticks).toBe(3);
	});

	it("runs timers in time order and lets awaited work schedule more timers", async () => {
		const clock = new ManualClock();
		const order: string[] = [];
		clock.every(1_000, () => order.push(`tick@${clock.now()}`));
		void (async () => {
			await clock.sleep(1_500);
			order.push(`a@${clock.now()}`);
			await clock.sleep(200);
			order.push(`b@${clock.now()}`);
		})();
		await clock.advance(2_000);
		expect(order).toEqual(["tick@1000", "a@1500", "b@1700", "tick@2000"]);
	});
});

describe("RealClock", () => {
	it("sleeps for real time", async () => {
		const clock = new RealClock();
		const start = clock.now();
		await clock.sleep(20);
		expect(clock.now() - start).toBeGreaterThanOrEqual(15);
	});
});
