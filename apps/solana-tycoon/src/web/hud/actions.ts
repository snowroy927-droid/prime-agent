export interface HudActions {
	snipe: (mint: string, holdConfirmed: boolean) => void;
	sell: (mint: string, pct: 50 | 100) => void;
	pin: (mint: string) => void;
	unpin: (mint: string) => void;
	select: (mint: string | null) => void;
	needsHold: (mint: string) => boolean;
}
