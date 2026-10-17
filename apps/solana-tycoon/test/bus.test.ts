import { describe, expect, it, vi } from "vitest";
import { EngineBus } from "../src/engine/bus";
import type { EngineEvent } from "../src/shared/protocol";

const event: EngineEvent = { type: "balance", lamports: "1000" };

describe("EngineBus", () => {
	it("delivers events to listeners until they unsubscribe", () => {
		const bus = new EngineBus();
		const seen: EngineEvent[] = [];
		const off = bus.on((e) => seen.push(e));
		bus.emit(event);
		off();
		bus.emit(event);
		expect(seen).toEqual([event]);
	});

	it("keeps delivering when one listener throws", () => {
		const bus = new EngineBus();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const seen: EngineEvent[] = [];
		bus.on(() => {
			throw new Error("boom");
		});
		bus.on((e) => seen.push(e));
		bus.emit(event);
		expect(seen).toEqual([event]);
		expect(errors).toHaveBeenCalledOnce();
		errors.mockRestore();
	});
});
