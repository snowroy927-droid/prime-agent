import { describe, expect, it } from "vitest";
import { RpcBudget } from "../src/engine/chain/rpcBudget";
import { ManualClock } from "../src/engine/clock";

describe("RpcBudget", () => {
	it("allows maxPerSecond calls and refuses more until a second passes", async () => {
		const clock = new ManualClock(0);
		const budget = new RpcBudget(5, clock);
		for (let i = 0; i < 5; i++) expect(budget.tryTake()).toBe(true);
		expect(budget.tryTake()).toBe(false);
		await clock.advance(1_000);
		expect(budget.tryTake()).toBe(true);
	});

	it("charges multi-call costs and never banks more than one second", async () => {
		const clock = new ManualClock(0);
		const budget = new RpcBudget(4, clock);
		expect(budget.tryTake(3)).toBe(true);
		expect(budget.tryTake(2)).toBe(false);
		await clock.advance(10_000);
		expect(budget.tryTake(4)).toBe(true);
		expect(budget.tryTake()).toBe(false);
	});

	it("reports affordability without spending", () => {
		const budget = new RpcBudget(3, new ManualClock(0));
		expect(budget.canAfford(3)).toBe(true);
		expect(budget.canAfford(3)).toBe(true);
		expect(budget.tryTake(3)).toBe(true);
		expect(budget.canAfford(1)).toBe(false);
	});
});
