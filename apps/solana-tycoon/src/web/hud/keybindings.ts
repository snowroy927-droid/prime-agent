export type ActionId =
	| "hotbar1"
	| "hotbar2"
	| "hotbar3"
	| "hotbar4"
	| "hotbar5"
	| "hotbar6"
	| "radarUp"
	| "radarDown"
	| "snipeSelected"
	| "analytics"
	| "mute"
	| "pause"
	| "kill"
	| "switchDesk";

export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
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
};

export const ACTION_LABELS: Record<ActionId, string> = {
	hotbar1: "Hotbar 1",
	hotbar2: "Hotbar 2",
	hotbar3: "Hotbar 3",
	hotbar4: "Hotbar 4",
	hotbar5: "Hotbar 5",
	hotbar6: "Hotbar 6",
	radarUp: "Radar up",
	radarDown: "Radar down",
	snipeSelected: "Snipe selected",
	analytics: "Analytics",
	mute: "Mute",
	pause: "Pause / resume",
	kill: "Kill switch (hold)",
	switchDesk: "Switch desk",
};

export interface KeyStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const STORAGE_KEY = "super-c-sniper.keybindings.v1";

export function browserStorage(): KeyStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

const normalize = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

export function loadKeybindings(storage: KeyStorage | null = browserStorage()): Record<ActionId, string> {
	const bindings = { ...DEFAULT_KEYBINDINGS };
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		if (!raw) return bindings;
		const saved: unknown = JSON.parse(raw);
		if (typeof saved !== "object" || saved === null) return bindings;
		for (const action of Object.keys(DEFAULT_KEYBINDINGS) as ActionId[]) {
			const value = (saved as Record<string, unknown>)[action];
			if (typeof value === "string" && value !== "") bindings[action] = value;
		}
	} catch {
		return { ...DEFAULT_KEYBINDINGS };
	}
	return bindings;
}

export function saveKeybindings(
	bindings: Record<ActionId, string>,
	storage: KeyStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(bindings));
	} catch {
		// Private browsing or full storage: keep the bindings for this page only.
	}
}

export function actionForKey(bindings: Record<ActionId, string>, key: string): ActionId | null {
	const pressed = normalize(key);
	for (const action of Object.keys(bindings) as ActionId[]) {
		if (normalize(bindings[action]) === pressed) return action;
	}
	return null;
}
