import { describe, expect, it } from "vitest";
import { DEFAULT_KRAKEN_SETTINGS } from "../src/shared/kraken";
import { KRAKEN_SECTIONS } from "../src/web/hud/settingsFields";

function leafPaths(value: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(value).flatMap(([key, child]) =>
		typeof child === "object" && child !== null && !Array.isArray(child)
			? leafPaths(child as Record<string, unknown>, `${prefix}${key}.`)
			: [`${prefix}${key}`],
	);
}

describe("Kraken settings fields", () => {
	it("cover every Kraken setting in spec Section 12, with autoBuy as the panel toggle", () => {
		const fields = KRAKEN_SECTIONS.flatMap((section) => section.fields.map((field) => field.path));
		expect(new Set(fields).size).toBe(fields.length);
		expect([...fields, "autoBuy"].sort()).toEqual(leafPaths(DEFAULT_KRAKEN_SETTINGS).sort());
	});
});
