import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { consecutiveLosses, tiltUntil } from "../src/shared/tilt";
import { closed, LOSS, WIN } from "./helpers/trades";

describe("tilt", () => {
	it("trips after the configured number of consecutive losses", () => {
		const closes = [closed(LOSS, 1_000), closed(LOSS, 2_000), closed(LOSS, 3_000)];
		expect(consecutiveLosses(closes)).toBe(3);
		expect(tiltUntil(closes, DEFAULT_SETTINGS)).toBe(3_000 + 600_000);
	});

	it("stays clear below the threshold", () => {
		const closes = [closed(WIN, 1_000), closed(LOSS, 2_000), closed(LOSS, 3_000)];
		expect(consecutiveLosses(closes)).toBe(2);
		expect(tiltUntil(closes, DEFAULT_SETTINGS)).toBeNull();
	});

	it("breaks the loss streak on a breakeven close", () => {
		const closes = [closed(LOSS, 1_000), closed(LOSS, 2_000), closed(0n, 3_000), closed(LOSS, 4_000)];
		expect(consecutiveLosses(closes)).toBe(1);
	});

	it("orders closes by closedAt regardless of input order", () => {
		const closes = [closed(LOSS, 3_000), closed(WIN, 4_000), closed(LOSS, 1_000), closed(LOSS, 2_000)];
		expect(consecutiveLosses(closes)).toBe(0);
	});
});
