import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/shared/prng";

describe("mulberry32", () => {
	it("repeats the same sequence for the same seed", () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		const first = Array.from({ length: 5 }, () => a());
		expect(Array.from({ length: 5 }, () => b())).toEqual(first);
		expect(new Set(first).size).toBe(5);
	});

	it("stays in [0, 1)", () => {
		const next = mulberry32(7);
		for (let i = 0; i < 10_000; i++) {
			const value = next();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});
