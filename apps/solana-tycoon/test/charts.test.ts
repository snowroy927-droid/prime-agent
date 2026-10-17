import { describe, expect, it } from "vitest";
import {
	type ChartColors,
	combinedRealizedUsd,
	drawLines,
	niceTicks,
	scaleLinear,
	verdictCopy,
} from "../src/web/hud/charts";

// Enough of a 2D context for drawing code to run in node: every method is a no-op and text is 8px per character.
function stubContext(): CanvasRenderingContext2D {
	const state: Record<string | symbol, unknown> = {};
	return new Proxy(state, {
		get: (target, key) =>
			key === "measureText"
				? (text: string) => ({ width: text.length * 8 })
				: key in target
					? target[key]
					: () => undefined,
		set: (target, key, value) => {
			target[key] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
}

const COLORS: ChartColors = {
	mark: "#3fd16b",
	positive: "#17a693",
	negative: "#de6838",
	grid: "#232c4d",
	text: "#e3e9f7",
	muted: "#8692b8",
	surface: "#0d1122",
};

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

describe("combined analytics", () => {
	it("adds pump.fun SOL at the SOL/USD rate to Kraken USD", () => {
		expect(combinedRealizedUsd(0.5, 150, 12)).toEqual({ totalUsd: 87, note: null });
	});

	it("gives no total and says why when there is no SOL/USD price", () => {
		expect(combinedRealizedUsd(0.5, null, 12)).toEqual({
			totalUsd: null,
			note: "No SOL/USD price; pump.fun shown in SOL",
		});
	});

	it("draws both series on one shared scale and returns a hit per point", () => {
		const hits = drawLines(
			stubContext(),
			[
				{
					label: "PUMP.FUN",
					color: "#3987e5",
					points: [
						{ x: 0, y: 0 },
						{ x: 10, y: 5 },
					],
				},
				{
					label: "KRAKEN",
					color: "#d55181",
					points: [
						{ x: 0, y: 0 },
						{ x: 5, y: -2 },
						{ x: 10, y: 10 },
					],
				},
			],
			{ x: 0, y: 0, w: 400, h: 200 },
			COLORS,
		);
		expect(hits).toHaveLength(5);
		const at = (label: string, value: string) => {
			const hit = hits.find((item) => item.label.startsWith(label) && item.value === value);
			if (!hit) throw new Error(`no hit for ${label} ${value}`);
			return hit;
		};
		const zero = at("KRAKEN", "0").cy;
		const ten = at("KRAKEN", "10").cy;
		expect(at("PUMP.FUN", "0").cy).toBe(zero);
		expect(at("PUMP.FUN", "5").cy).toBeCloseTo((zero + ten) / 2);
		expect(at("KRAKEN", "-2").cy).toBeGreaterThan(zero);
		expect(at("PUMP.FUN", "5").cx).toBe(at("KRAKEN", "10").cx);
		expect(hits.map((hit) => hit.cx)).toEqual([...hits.map((hit) => hit.cx)].sort((a, b) => a - b));
	});
});
