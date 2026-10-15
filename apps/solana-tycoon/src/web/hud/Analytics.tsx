import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { TierId } from "../../shared/combo";
import type { ExitReason } from "../../shared/types";
import { lamportsToSol } from "../../shared/units";
import { hudColors } from "../scene/palettes";
import type { GameState } from "../state/store";
import { type Box, type ChartColors, drawBars, drawLine, drawScatter, type Hit, verdictCopy } from "./charts";
import { age, clockTime } from "./format";

// Gain/loss pair validated for the dark surface (lightness band, CVD separation, contrast);
// polarity is also encoded by position above or below zero.
const GAIN = "#17a693";
const LOSS = "#de6838";

function chartColors(tier: TierId): ChartColors {
	return {
		mark: hudColors(tier).accent,
		positive: GAIN,
		negative: LOSS,
		grid: "#232c4d",
		text: "#e3e9f7",
		muted: "#8692b8",
		surface: "#0d1122",
	};
}

// Values stay in text ink; a small square in the gain/loss colour sits beside them.
const polarity = (value: number) => (value > 0 ? "pol-up" : value < 0 ? "pol-down" : "");
const sol = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
const seconds = (value: number) => (value < 60 ? `${Math.round(value)}s` : `${(value / 60).toFixed(1)}m`);

const REASON_LABELS: Record<ExitReason, string> = {
	take_profit: "Take profit",
	stop_loss: "Stop loss",
	trailing: "Trailing stop",
	manual: "Manual",
	kill: "Kill switch",
	max_hold: "Max hold",
};

interface ChartProps {
	title: string;
	subtitle: string;
	empty: string;
	hasData: boolean;
	mode: "x" | "y" | "xy";
	crosshair?: boolean;
	draw: (ctx: CanvasRenderingContext2D, box: Box) => Hit[];
}

function Chart({ title, subtitle, empty, hasData, mode, crosshair, draw }: ChartProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const hits = useRef<Hit[]>([]);
	const [active, setActive] = useState<number | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const observer = new ResizeObserver(() => {
			const rect = canvas.getBoundingClientRect();
			setSize({ width: rect.width, height: rect.height });
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || size.width === 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(size.width * dpr);
		canvas.height = Math.round(size.height * dpr);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, size.width, size.height);
		hits.current = hasData ? draw(ctx, { x: 0, y: 0, w: size.width, h: size.height }) : [];
	});

	const nearest = (x: number, y: number): number | null => {
		let best: number | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		hits.current.forEach((hit, i) => {
			const distance =
				mode === "x"
					? Math.abs(hit.cx - x)
					: mode === "y"
						? Math.abs(hit.cy - y)
						: Math.hypot(hit.cx - x, hit.cy - y);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = i;
			}
		});
		return mode === "xy" && bestDistance > 24 ? null : best;
	};

	const onMove = (event: PointerEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		setActive(nearest(event.clientX - rect.left, event.clientY - rect.top));
	};

	const onKey = (event: KeyboardEvent<HTMLCanvasElement>) => {
		if (hits.current.length === 0) return;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			event.preventDefault();
			setActive((i) => Math.min(hits.current.length - 1, i === null ? 0 : i + 1));
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			event.preventDefault();
			setActive((i) => Math.max(0, i === null ? hits.current.length - 1 : i - 1));
		}
	};

	const hit = active === null ? null : hits.current[active];
	return (
		<figure className="chart">
			<figcaption>
				<span className="chart-title">{title}</span>
				<span className="chart-sub">{subtitle}</span>
			</figcaption>
			<div className="chart-body">
				<canvas
					ref={canvasRef}
					tabIndex={hasData ? 0 : -1}
					aria-label={`${title}. ${subtitle}. Use arrow keys to read values; all values are in the table view.`}
					onPointerMove={onMove}
					onPointerLeave={() => setActive(null)}
					onKeyDown={onKey}
					onBlur={() => setActive(null)}
				/>
				{!hasData ? <div className="chart-empty">{empty}</div> : null}
				{hit && crosshair ? <div className="crosshair" style={{ left: hit.cx }} /> : null}
				{hit ? (
					<div className="tip" style={{ left: Math.min(Math.max(hit.cx, 70), size.width - 70), top: hit.cy }}>
						<strong>{hit.value}</strong>
						<span>{hit.label}</span>
					</div>
				) : null}
			</div>
		</figure>
	);
}

interface Props {
	state: GameState;
	onClose: () => void;
}

export function Analytics({ state, onClose }: Props) {
	const [view, setView] = useState<"charts" | "table">("charts");
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const dialogRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => closeRef.current?.focus(), []);

	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab" || !dialogRef.current) return;
			// Keep focus inside the terminal while it is open.
			const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]')].filter(
				(element) => !element.hasAttribute("disabled"),
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const inside = dialogRef.current.contains(document.activeElement);
			if (event.shiftKey && (document.activeElement === first || !inside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (document.activeElement === last || !inside)) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);
	const snapshot = state.snapshot;
	if (!snapshot) return null;
	const { stats, launchStats } = snapshot;
	const colors = chartColors(state.tier);
	const verdict = verdictCopy(stats.verdict);
	const closes = snapshot.closes;
	const recent = closes.slice(-60);
	const ci = stats.expectancyCi90;
	const mode = snapshot.synthetic ? "SYNTHETIC DEMO" : snapshot.mode.toUpperCase();
	const reasons = (Object.keys(stats.exitReasons) as ExitReason[]).filter((reason) => stats.exitReasons[reason] > 0);
	const launches24h = launchStats.perHour.reduce((total, n) => total + n, 0);

	return (
		<div className="modal analytics-modal">
			<div ref={dialogRef} className="terminal" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
				<div className="sheet-head">
					<h3 id="analytics-title">ANALYTICS TERMINAL</h3>
					<span className="badge badge-sim">{mode}</span>
					<span className="spacer" />
					<div className="segmented" role="tablist" aria-label="View">
						<button
							type="button"
							role="tab"
							aria-selected={view === "charts"}
							className={`btn ${view === "charts" ? "on" : ""}`}
							onClick={() => setView("charts")}
						>
							CHARTS
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={view === "table"}
							className={`btn ${view === "table" ? "on" : ""}`}
							onClick={() => setView("table")}
						>
							TABLE
						</button>
					</div>
					<button ref={closeRef} type="button" className="btn" onClick={onClose}>
						CLOSE
					</button>
				</div>

				<output className={`verdict-box ${verdict.tone}`}>
					<span className="verdict-label">EXPERIMENT VERDICT ({mode})</span>
					<span>{verdict.text}</span>
				</output>

				<div className="tiles">
					<div className="tile hero">
						<div className="k">REALIZED PNL</div>
						<div className={`v pol ${polarity(stats.realizedSol)}`}>{sol(stats.realizedSol)} SOL</div>
						<div className="s">{stats.trades} closed trades</div>
					</div>
					<div className="tile">
						<div className="k">EXPECTANCY / TRADE</div>
						<div className="v">{stats.trades ? sol(stats.expectancySol) : "--"}</div>
						<div className="s">{ci ? `90% CI ${sol(ci[0])} to ${sol(ci[1])}` : "CI needs 2+ closes"}</div>
					</div>
					<div className="tile">
						<div className="k">WIN RATE</div>
						<div className="v">{stats.trades ? `${(stats.winRate * 100).toFixed(0)}%` : "--"}</div>
						<div className="s">
							{stats.wins} won / {stats.losses} lost
						</div>
					</div>
					<div className="tile">
						<div className="k">PROFIT FACTOR</div>
						<div className="v">{stats.profitFactor === null ? "--" : stats.profitFactor.toFixed(2)}</div>
						<div className="s">
							{stats.losses === 0
								? stats.wins === 0
									? "no trades yet"
									: "no losing trades yet"
								: `avg win ${stats.avgWinSol.toFixed(4)} / loss ${stats.avgLossSol.toFixed(4)}`}
						</div>
					</div>
					<div className="tile">
						<div className="k">BEST / WORST</div>
						<div className="v">{stats.bestSol === null ? "--" : sol(stats.bestSol)}</div>
						<div className="s">{stats.worstSol === null ? "no trades yet" : `worst ${sol(stats.worstSol)}`}</div>
					</div>
					<div className="tile">
						<div className="k">CHECK PASS RATE</div>
						<div className="v">{launchStats.checked ? `${(launchStats.passRate * 100).toFixed(0)}%` : "--"}</div>
						<div className="s">
							{launchStats.approved} of {launchStats.checked} checked | {launches24h} launches in 24h
						</div>
					</div>
				</div>

				{view === "charts" ? (
					<div className="charts">
						<Chart
							title="CUMULATIVE PNL"
							subtitle="Realized SOL after fees, by close time"
							empty="No closed trades yet."
							hasData={stats.cumulative.length > 0}
							mode="x"
							crosshair
							draw={(ctx, box) =>
								drawLine(
									ctx,
									[
										// Zero when the first closed trade opened.
										{ x: (stats.cumulative[0]?.at ?? 0) - (stats.holds[0]?.holdSec ?? 0) * 1000, y: 0 },
										...stats.cumulative.map((point) => ({ x: point.at, y: point.sol })),
									],
									box,
									colors,
									{ x: clockTime, y: (v) => v.toFixed(3) },
								)
							}
						/>
						<Chart
							title="PNL PER TRADE"
							subtitle={`Last ${recent.length} closes, SOL; up is a gain, down a loss`}
							empty="No closed trades yet."
							hasData={recent.length > 0}
							mode="x"
							draw={(ctx, box) =>
								drawBars(
									ctx,
									recent.map((trade) => lamportsToSol(trade.pnlLamports)),
									recent.map((trade) => `${trade.symbol} ${clockTime(trade.closedAt)}`),
									box,
									colors,
									{ polarity: true, format: (v) => v.toFixed(3) },
								)
							}
						/>
						<Chart
							title="EXIT REASONS"
							subtitle="Closed trades by what closed them"
							empty="No closed trades yet."
							hasData={reasons.length > 0}
							mode="y"
							draw={(ctx, box) =>
								drawBars(
									ctx,
									reasons.map((reason) => stats.exitReasons[reason]),
									reasons.map((reason) => REASON_LABELS[reason]),
									box,
									colors,
									{ horizontal: true },
								)
							}
						/>
						<Chart
							title="LAUNCHES PER HOUR"
							subtitle="Last 24 hours, oldest first"
							empty="No launches seen in the last 24 hours."
							hasData={launches24h > 0}
							mode="x"
							draw={(ctx, box) =>
								drawBars(
									ctx,
									launchStats.perHour,
									launchStats.perHour.map((_, i) => (i === 23 ? "now" : `-${23 - i}h`)),
									box,
									colors,
								)
							}
						/>
						<Chart
							title="TOP REJECTIONS"
							subtitle="First failing rule of each rejected launch"
							empty="No rejections yet."
							hasData={launchStats.topRejections.length > 0}
							mode="y"
							draw={(ctx, box) =>
								drawBars(
									ctx,
									launchStats.topRejections.map((row) => row.count),
									launchStats.topRejections.map((row) => row.rule.replaceAll("_", " ")),
									box,
									colors,
									{ horizontal: true },
								)
							}
						/>
						<Chart
							title="HOLD TIME VS PNL"
							subtitle="Each dot is a closed trade"
							empty="No closed trades yet."
							hasData={stats.holds.length > 0}
							mode="xy"
							draw={(ctx, box) =>
								drawScatter(
									ctx,
									stats.holds.map((hold) => ({ x: hold.holdSec, y: hold.pnlSol })),
									box,
									colors,
									{ x: seconds, y: (v) => v.toFixed(3) },
								)
							}
						/>
					</div>
				) : (
					<div className="table-wrap">
						<table className="trades">
							<caption>Closed trades, newest first ({closes.length})</caption>
							<thead>
								<tr>
									<th scope="col">CLOSED</th>
									<th scope="col">COIN</th>
									<th scope="col">EXIT</th>
									<th scope="col">HELD</th>
									<th scope="col" className="num">
										PNL SOL
									</th>
									<th scope="col" className="num">
										PNL %
									</th>
								</tr>
							</thead>
							<tbody>
								{closes.length === 0 ? (
									<tr>
										<td colSpan={6}>No closed trades yet.</td>
									</tr>
								) : (
									[...closes].reverse().map((trade) => (
										<tr key={trade.positionId}>
											<td>{clockTime(trade.closedAt)}</td>
											<td>{trade.symbol}</td>
											<td>{REASON_LABELS[trade.reason]}</td>
											<td>{age(trade.closedAt - trade.openedAt)}</td>
											<td className={`num pol ${polarity(lamportsToSol(trade.pnlLamports))}`}>
												{sol(lamportsToSol(trade.pnlLamports))}
											</td>
											<td className="num">{trade.pnlPct.toFixed(1)}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				)}
				<p className="foot">
					Expectancy is the mean PnL per closed trade; the 90% interval is mean +/- 1.645 standard errors. The
					verdict waits for 50 closes in this mode.
				</p>
			</div>
		</div>
	);
}
