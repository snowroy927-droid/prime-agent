import { CanvasTexture, NearestFilter } from "three";
import { lamportsToSol } from "../../shared/units";
import type { GameState } from "../state/store";
import type { ScreenId } from "./office";
import { BASE_PALETTE, hudColors } from "./palettes";

const REDRAW_MS = 250;
const BG = BASE_PALETTE[0];
const GOOD = BASE_PALETTE[10];
const BAD = BASE_PALETTE[12];
const DIM = BASE_PALETTE[3];
const RAIL = BASE_PALETTE[1];

interface Surface {
	ctx: CanvasRenderingContext2D;
	texture: CanvasTexture;
	width: number;
	height: number;
}

function surface(width: number, height: number): Surface {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2D canvas unavailable");
	const texture = new CanvasTexture(canvas);
	texture.magFilter = NearestFilter;
	texture.minFilter = NearestFilter;
	texture.generateMipmaps = false;
	return { ctx, texture, width, height };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string): void {
	ctx.fillStyle = color;
	ctx.font = '8px "Press Start 2P", monospace';
	ctx.textBaseline = "top";
	ctx.fillText(value, x, y);
}

function clear({ ctx, width, height }: Surface): void {
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, width, height);
}

// Cumulative realized PnL drawn as chunky 2px dots between points.
function sparkline(
	ctx: CanvasRenderingContext2D,
	state: GameState,
	x: number,
	y: number,
	w: number,
	h: number,
	color: string,
): void {
	const points = [0];
	let running = 0;
	for (const trade of state.snapshot?.closes.slice(-60) ?? []) {
		running += lamportsToSol(trade.pnlLamports);
		points.push(running);
	}
	const low = Math.min(0, ...points);
	const high = Math.max(0.0001, ...points);
	const sx = (i: number) => x + (i / Math.max(1, points.length - 1)) * w;
	const sy = (v: number) => y + h - ((v - low) / (high - low)) * h;
	ctx.fillStyle = BASE_PALETTE[2];
	ctx.fillRect(x, Math.round(sy(0)), w, 1);
	ctx.fillStyle = color;
	for (let i = 1; i < points.length; i++) {
		const [x0, x1, y0, y1] = [sx(i - 1), sx(i), sy(points[i - 1]), sy(points[i])];
		const steps = Math.max(1, Math.ceil(Math.abs(x1 - x0)) + Math.ceil(Math.abs(y1 - y0)));
		for (let k = 0; k <= steps; k++) {
			ctx.fillRect(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps), 2, 2);
		}
	}
}

export class MonitorTextures {
	readonly textures: Record<ScreenId, CanvasTexture>;
	private readonly surfaces: Record<ScreenId, Surface>;
	private lastDraw = Number.NEGATIVE_INFINITY;

	constructor() {
		this.surfaces = {
			scout: surface(48, 36),
			analyst: surface(48, 36),
			trader: surface(48, 36),
			cfo: surface(48, 36),
			ceo: surface(48, 36),
			wall: surface(160, 80),
			inky: surface(48, 36),
			ticker: surface(128, 52),
		};
		this.textures = Object.fromEntries(Object.entries(this.surfaces).map(([id, s]) => [id, s.texture])) as Record<
			ScreenId,
			CanvasTexture
		>;
	}

	update(state: GameState, now = performance.now()): void {
		if (now - this.lastDraw < REDRAW_MS) return;
		this.lastDraw = now;
		const accent = hudColors(state.tier).accent;
		const snapshot = state.snapshot;

		const scout = this.surfaces.scout;
		clear(scout);
		if (!snapshot || snapshot.feed.status !== "live") {
			text(scout.ctx, "ZZ", 14, 12, DIM);
		} else {
			snapshot.launches.slice(0, 5).forEach((entry, i) => {
				const verdict = entry.check?.verdict;
				scout.ctx.fillStyle = verdict === "approved" ? GOOD : verdict === "rejected" ? BAD : BASE_PALETTE[4];
				scout.ctx.fillRect(4, 4 + i * 6, 6 + ((now / 40 + i * 13) % 34), 4);
			});
		}

		const analyst = this.surfaces.analyst;
		clear(analyst);
		const decided = snapshot?.launches.find(
			(entry) => entry.check?.verdict === "approved" || entry.check?.verdict === "rejected",
		);
		if (decided?.check) {
			const ok = decided.check.verdict === "approved";
			analyst.ctx.fillStyle = ok ? GOOD : BAD;
			analyst.ctx.fillRect(6, 6, 36, 24);
			text(analyst.ctx, ok ? "OK" : "NO", 16, 14, BG);
		}

		const trader = this.surfaces.trader;
		clear(trader);
		trader.ctx.fillStyle = DIM;
		trader.ctx.fillRect(23, 2, 1, 32);
		(snapshot?.positions ?? []).slice(0, 3).forEach((position, i) => {
			const pnl = position.pnlPct ?? 0;
			const width = Math.max(1, Math.min(1, Math.abs(pnl) / 100) * 20);
			trader.ctx.fillStyle = pnl >= 0 ? GOOD : BAD;
			trader.ctx.fillRect(pnl >= 0 ? 24 : 24 - width, 5 + i * 10, width, 6);
		});

		const cfo = this.surfaces.cfo;
		clear(cfo);
		sparkline(cfo.ctx, state, 3, 3, 42, 30, accent);

		const ceo = this.surfaces.ceo;
		clear(ceo);
		for (let i = 0; i < 5; i++) {
			ceo.ctx.fillStyle = i < state.combo ? accent : RAIL;
			ceo.ctx.fillRect(4 + i * 8, 22, 6, 10);
		}
		text(ceo.ctx, `x${state.combo}`, 12, 6, accent);

		const wall = this.surfaces.wall;
		clear(wall);
		text(wall.ctx, "SUPER C SNIPER", 6, 5, accent);
		wall.ctx.fillStyle = RAIL;
		wall.ctx.fillRect(6, 17, 148, 46);
		sparkline(wall.ctx, state, 8, 19, 144, 42, accent);
		text(
			wall.ctx,
			state.tier === "cold" ? "COLD" : `COMBO x${state.combo}`,
			6,
			67,
			state.tier === "cold" ? BASE_PALETTE[4] : accent,
		);
		const realized = snapshot?.stats.realized ?? 0;
		text(wall.ctx, `${realized >= 0 ? "+" : ""}${realized.toFixed(3)}`, 98, 67, realized >= 0 ? GOOD : BAD);

		const kraken = snapshot?.kraken ?? null;
		const movers = kraken?.movers.slice(0, 5) ?? [];
		const inky = this.surfaces.inky;
		clear(inky);
		if (!kraken || kraken.error || kraken.feed.status !== "live") {
			text(inky.ctx, "ZZ", 14, 12, DIM);
		} else {
			inky.ctx.fillStyle = DIM;
			inky.ctx.fillRect(23, 2, 1, 32);
			movers.forEach((mover, i) => {
				const change = mover.change15m ?? 0;
				const width = Math.max(1, Math.min(20, Math.abs(change) * 2));
				inky.ctx.fillStyle = mover.status === "eligible" ? GOOD : change >= 0 ? BASE_PALETTE[14] : BAD;
				inky.ctx.fillRect(change >= 0 ? 24 : 24 - width, 3 + i * 6, width, 4);
			});
		}

		const ticker = this.surfaces.ticker;
		clear(ticker);
		if (kraken?.error) {
			text(ticker.ctx, "KRAKEN OFFLINE", 8, 20, BAD);
		} else if (movers.length === 0) {
			text(ticker.ctx, "KRAKEN", 40, 20, DIM);
		} else {
			movers.forEach((mover, i) => {
				const change = mover.change15m;
				const label = change === null ? "--" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
				text(ticker.ctx, mover.symbol.slice(0, 6), 3, 2 + i * 10, BASE_PALETTE[5]);
				text(ticker.ctx, label, 125 - label.length * 8, 2 + i * 10, change !== null && change < 0 ? BAD : GOOD);
			});
		}

		for (const s of Object.values(this.surfaces)) s.texture.needsUpdate = true;
	}

	dispose(): void {
		for (const texture of Object.values(this.textures)) texture.dispose();
	}
}
