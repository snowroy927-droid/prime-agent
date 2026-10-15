import { describe, expect, it } from "vitest";
import { niceTicks, scaleLinear, verdictCopy } from "../src/web/hud/charts";

describe("chart math", () => {
	it("maps a domain onto a range linearly", () => {
		expect(scaleLinear([0, 10], [0, 100])(5)).toBe(50);
		expect(scaleLinear([-1, 1], [200, 0])(0)).toBe(100);
		expect(scaleLinear([3, 3], [0, 10])(3)).toBe(5);
	});

	it("picks clean tick values that cover the data", () => {
		expect(niceTicks(0, 0.37, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
		expect(niceTicks(-0.05, 0.12, 4)).toEqual([-0.05, 0, 0.05, 0.1, 0.15]);
		expect(niceTicks(0, 0, 4)).toEqual([0, 1]);
		expect(niceTicks(0, 23, 4)).toEqual([0, 5, 10, 15, 20, 25]);
	});
});

describe("verdictCopy", () => {
	it("explains each experiment verdict", () => {
		expect(verdictCopy({ kind: "collecting", needed: 46 })).toEqual({
			text: "Need 46 more closes for a verdict",
			tone: "neutral",
		});
		expect(verdictCopy({ kind: "losing" })).toEqual({ text: "Strategy is losing money", tone: "bad" });
		expect(verdictCopy({ kind: "not_losing" })).toEqual({
			text: "No evidence of losing money (90% CI)",
			tone: "good",
		});
	});
});
