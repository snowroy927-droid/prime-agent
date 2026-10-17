import { describe, expect, it } from "vitest";
import {
	actionForKey,
	DEFAULT_KEYBINDINGS,
	type KeyStorage,
	loadKeybindings,
	saveKeybindings,
} from "../src/web/hud/keybindings";

class MemoryStorage implements KeyStorage {
	readonly items = new Map<string, string>();
	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}
}

describe("keybindings", () => {
	it("ships the spec defaults", () => {
		expect(DEFAULT_KEYBINDINGS).toEqual({
			hotbar1: "1",
			hotbar2: "2",
			hotbar3: "3",
			hotbar4: "4",
			hotbar5: "5",
			hotbar6: "6",
			radarUp: "ArrowUp",
			radarDown: "ArrowDown",
			snipeSelected: "s",
			analytics: "Tab",
			mute: "m",
			pause: "p",
			kill: "k",
			switchDesk: "d",
		});
		expect(actionForKey(DEFAULT_KEYBINDINGS, "k")).toBe("kill");
		expect(actionForKey(DEFAULT_KEYBINDINGS, "K")).toBe("kill");
		expect(actionForKey(DEFAULT_KEYBINDINGS, "x")).toBeNull();
	});

	it("falls back to defaults on corrupt or missing storage", () => {
		const storage = new MemoryStorage();
		expect(loadKeybindings(storage)).toEqual(DEFAULT_KEYBINDINGS);
		storage.setItem("super-c-sniper.keybindings.v1", "{not json");
		expect(loadKeybindings(storage)).toEqual(DEFAULT_KEYBINDINGS);
		storage.setItem("super-c-sniper.keybindings.v1", JSON.stringify({ kill: 7, mute: "n" }));
		expect(loadKeybindings(storage)).toEqual({ ...DEFAULT_KEYBINDINGS, mute: "n" });
		expect(loadKeybindings(null)).toEqual(DEFAULT_KEYBINDINGS);
	});

	it("persists a rebinding", () => {
		const storage = new MemoryStorage();
		saveKeybindings({ ...DEFAULT_KEYBINDINGS, kill: "x" }, storage);
		const loaded = loadKeybindings(storage);
		expect(loaded.kill).toBe("x");
		expect(actionForKey(loaded, "x")).toBe("kill");
		expect(actionForKey(loaded, "k")).toBeNull();
	});
});
