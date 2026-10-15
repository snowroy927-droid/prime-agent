import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { TierId } from "../../shared/combo";
import type { KrakenSnapshot } from "../../shared/kraken";
import type { EngineSnapshot } from "../../shared/protocol";
import type { Stats } from "../../shared/stats";
import type { ExitReason } from "../../shared/types";
import { lamportsToSol } from "../../shared/units";
import { hudColors } from "../scene/palettes";
import { activeDesk, type GameState, screenTier } from "../state/store";
import {
	type Box,
	type ChartColors,
	combinedRealizedUsd,
	drawBars,
	drawLine,
	drawLines,
	drawScatter,
	type Hit,
	type Series,
	verdictCopy,
} from "./charts";
import { age, clockTime } from "./format";

// Gain/loss pair validated for the dark surface (lightness band, CVD separation, contrast);
// polarity is also encoded by position above or below zero.
const GAIN = "#17a693";
const LOSS = "#de6838";
// Desk identity on the combined chart: dataviz validator, dark mode on #0d1122, CVD dE 15.9, normal dE 26.5.
const PUMP_SERIES = "#3987e5";
const KRAKEN_SERIES = "#d55181";

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
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "-" : "");
const sol = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
const usd = (value: number) => `${sign(value)}$${Math.abs(value).toFixed(2)}`;
const usdAxis = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : 2)}`;
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
	legend?: { label: string; color: string }[];
	draw: (ctx: CanvasRenderingContext2D, box: Box) => Hit[];
}

function Chart({ title, subtitle, empty, hasData, mode, crosshair, legend, draw }: ChartProps) {
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
				{legend ? (
					<span className="legend">
						{legend.map((item) => (
							<span key={item.label} className="legend-item">
								<span className="swatch" style={{ background: item.color }} aria-hidden="true" />
								{item.label}
							</span>
						))}
					</span>
				) : null}
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

interface TradeRow {
	id: string;
	desk: string;
	symbol: string;
	reason: ExitReason;
	openedAt: number;
	closedAt: number;
	pnl: number;
	pnlPct: number;
}

// One desk's report: the Milestone 1 terminal in that desk's unit.
interface DeskReport {
	name: string;
	unit: "SOL" | "USD";
	stats: Stats;
	signed: (value: number) => string;
	axis: (value: number) => string;
	trades: TradeRow[];
	activityTile: { k: string; v: string; s: string };
	activity: { title: string; subtitle: string; empty: string; values: number[] };
	breakdown: { title: string; subtitle: string; empty: string; rows: { label: string; count: number }[] };
}

function pumpReport(snapshot: EngineSnapshot): DeskReport {
	const { stats, launchStats } = snapshot;
	const launches24h = launchStats.perHour.reduce((total, n) => total + n, 0);
	return {
		name: "PUMP.FUN",
		unit: "SOL",
		stats,
		signed: sol,
		axis: (value) => value.toFixed(3),
		trades: snapshot.closes.map((trade) => ({
			id: trade.positionId,
			desk: "PUMP.FUN",
			symbol: trade.symbol,
			reason: trade.reason,
			openedAt: trade.openedAt,
			closedAt: trade.closedAt,
			pnl: lamportsToSol(trade.pnlLamports),
			pnlPct: trade.pnlPct,
		})),
		activityTile: {
			k: "CHECK PASS RATE",
			v: launchStats.checked ? `${(launchStats.passRate * 100).toFixed(0)}%` : "--",
			s: `${launchStats.approved} of ${launchStats.checked} checked | ${launches24h} launches in 24h`,
		},
		activity: {
			title: "LAUNCHES PER HOUR",
			subtitle: "Last 24 hours, oldest first",
			empty: "No launches seen in the last 24 hours.",
			values: launchStats.perHour,
		},
		breakdown: {
			title: "TOP REJECTIONS",
			subtitle: "First failing rule of each rejected launch",
			empty: "No rejections yet.",
			rows: launchStats.topRejections.map((row) => ({ label: row.rule.replaceAll("_", " "), count: row.count })),
		},
	};
}

function krakenReport(kraken: KrakenSnapshot): DeskReport {
	const { stats, scanStats } = kraken;
	const movers24h = scanStats.moversPerHour.reduce((total, n) => total + n, 0);
	const skips = scanStats.skipReasons.reduce((total, row) => total + row.count, 0);
	return {
		name: "KRAKEN",
		unit: "USD",
		stats,
		signed: usd,
		axis: usdAxis,
		trades: kraken.closes.map((trade) => ({
			id: trade.positionId,
			desk: "KRAKEN",
			symbol: trade.symbol,
			reason: trade.reason,
			openedAt: trade.openedAt,
			closedAt: trade.closedAt,
			pnl: Number(trade.pnlUsdMicros) / 1_000_000,
			pnlPct: trade.pnlPct,
		})),
		activityTile: {
			k: "MOVERS (24H)",
			v: String(movers24h),
			s: `${kraken.movers.filter((mover) => mover.status === "eligible").length} eligible now | ${skips} skips`,
		},
		activity: {
			title: "MOVERS PER HOUR",
			subtitle: "Distinct pairs that met the move condition, last 24 hours",
			empty: "No movers in the last 24 hours.",
			values: scanStats.moversPerHour,
		},
		breakdown: {
			title: "TOP SKIP REASONS",
			subtitle: "Why movers that met the move condition were not bought",
			empty: "No skipped movers yet.",
			rows: scanStats.skipReasons.map((row) => ({ label: row.reason, count: row.count })),
		},
	};
}

function Verdict({ label, stats }: { label: string; stats: Stats }) {
	const verdict = verdictCopy(stats.verdict);
	return (
		<output className={`verdict-box ${verdict.tone}`}>
			<span className="verdict-label">{label}</span>
			<span>{verdict.text}</span>
		</output>
	);
}

function TradesTable({
	trades,
	unitLabel,
	text,
}: {
	trades: TradeRow[];
	unitLabel: string;
	text: (row: TradeRow) => string;
}) {
	const showDesk = new Set(trades.map((row) => row.desk)).size > 1;
	return (
		<div className="table-wrap">
			<table className="trades">
				<caption>Closed trades, newest first ({trades.length})</caption>
				<thead>
					<tr>
						<th scope="col">CLOSED</th>
						{showDesk ? <th scope="col">DESK</th> : null}
						<th scope="col">COIN</th>
						<th scope="col">EXIT</th>
						<th scope="col">HELD</th>
						<th scope="col" className="num">
							{unitLabel}
						</th>
						<th scope="col" className="num">
							PNL %
						</th>
					</tr>
				</thead>
				<tbody>
					{trades.length === 0 ? (
						<tr>
							<td colSpan={showDesk ? 7 : 6}>No closed trades yet.</td>
						</tr>
					) : (
						[...trades]
							.sort((a, b) => b.closedAt - a.closedAt)
							.map((row) => (
								<tr key={`${row.desk}:${row.id}`}>
									<td>{clockTime(row.closedAt)}</td>
									{showDesk ? <td>{row.desk}</td> : null}
									<td>{row.symbol}</td>
									<td>{REASON_LABELS[row.reason]}</td>
									<td>{age(row.closedAt - row.openedAt)}</td>
									<td className={`num pol ${polarity(row.pnl)}`}>{text(row)}</td>
									<td className="num">{row.pnlPct.toFixed(1)}</td>
								</tr>
							))
					)}
				</tbody>
			</table>
		</div>
	);
}

// Cumulative PnL with a zero point when the first closed trade opened.
function cumulativePoints(stats: Stats, scale = 1): { x: number; y: number }[] {
	if (stats.cumulative.length === 0) return [];
	return [
		{ x: stats.cumulative[0].at - (stats.holds[0]?.holdSec ?? 0) * 1000, y: 0 },
		...stats.cumulative.map((point) => ({ x: point.at, y: point.value * scale })),
	];
}

function DeskView({
	report,
	view,
	mode,
	colors,
}: {
	report: DeskReport;
	view: string;
	mode: string;
	colors: ChartColors;
}) {
	const { stats } = report;
	const ci = stats.expectancyCi90;
	const recent = report.trades.slice(-60);
	const reasons = (Object.keys(stats.exitReasons) as ExitReason[]).filter((reason) => stats.exitReasons[reason] > 0);
	const amount = (value: number) => `${report.signed(value)}${report.unit === "SOL" ? " SOL" : ""}`;
	return (
		<>
			<Verdict label={`${report.name} VERDICT (${mode})`} stats={stats} />
			<div className="tiles">
				<div className="tile hero">
					<div className="k">REALIZED PNL</div>
					<div className={`v pol ${polarity(stats.realized)}`}>{amount(stats.realized)}</div>
					<div className="s">{stats.trades} closed trades</div>
				</div>
				<div className="tile">
					<div className="k">EXPECTANCY / TRADE</div>
					<div className="v">{stats.trades ? report.signed(stats.expectancy) : "--"}</div>
					<div className="s">
						{ci ? `90% CI ${report.signed(ci[0])} to ${report.signed(ci[1])}` : "CI needs 2+ closes"}
					</div>
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
							: `avg win ${report.signed(stats.avgWin)} / loss ${report.signed(-Math.abs(stats.avgLoss))}`}
					</div>
				</div>
				<div className="tile">
					<div className="k">BEST / WORST</div>
					<div className="v">{stats.best === null ? "--" : report.signed(stats.best)}</div>
					<div className="s">{stats.worst === null ? "no trades yet" : `worst ${report.signed(stats.worst)}`}</div>
				</div>
				<div className="tile">
					<div className="k">{report.activityTile.k}</div>
					<div className="v">{report.activityTile.v}</div>
					<div className="s">{report.activityTile.s}</div>
				</div>
			</div>
			{view === "charts" ? (
				<div className="charts">
					<Chart
						title="CUMULATIVE PNL"
						subtitle={`Realized ${report.unit} after fees, by close time`}
						empty="No closed trades yet."
						hasData={stats.cumulative.length > 0}
						mode="x"
						crosshair
						draw={(ctx, box) =>
							drawLine(ctx, cumulativePoints(stats), box, colors, { x: clockTime, y: report.axis })
						}
					/>
					<Chart
						title="PNL PER TRADE"
						subtitle={`Last ${recent.length} closes, ${report.unit}; up is a gain, down a loss`}
						empty="No closed trades yet."
						hasData={recent.length > 0}
						mode="x"
						draw={(ctx, box) =>
							drawBars(
								ctx,
								recent.map((row) => row.pnl),
								recent.map((row) => `${row.symbol} ${clockTime(row.closedAt)}`),
								box,
								colors,
								{ polarity: true, format: report.axis },
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
						title={report.activity.title}
						subtitle={report.activity.subtitle}
						empty={report.activity.empty}
						hasData={report.activity.values.some((n) => n > 0)}
						mode="x"
						draw={(ctx, box) =>
							drawBars(
								ctx,
								report.activity.values,
								report.activity.values.map((_, i, all) =>
									i === all.length - 1 ? "now" : `-${all.length - 1 - i}h`,
								),
								box,
								colors,
							)
						}
					/>
					<Chart
						title={report.breakdown.title}
						subtitle={report.breakdown.subtitle}
						empty={report.breakdown.empty}
						hasData={report.breakdown.rows.length > 0}
						mode="y"
						draw={(ctx, box) =>
							drawBars(
								ctx,
								report.breakdown.rows.map((row) => row.count),
								report.breakdown.rows.map((row) => row.label),
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
								stats.holds.map((hold) => ({ x: hold.holdSec, y: hold.pnl })),
								box,
								colors,
								{ x: seconds, y: report.axis },
							)
						}
					/>
				</div>
			) : (
				<TradesTable
					trades={report.trades}
					unitLabel={`PNL ${report.unit}`}
					text={(row) => report.signed(row.pnl)}
				/>
			)}
		</>
	);
}

function CombinedView({
	pump,
	kraken,
	solUsd,
	view,
	mode,
	colors,
}: {
	pump: DeskReport;
	kraken: DeskReport;
	solUsd: { price: string; at: number } | null;
	view: string;
	mode: string;
	colors: ChartColors;
}) {
	const rate = solUsd ? Number(solUsd.price) : null;
	const combined = combinedRealizedUsd(pump.stats.realized, rate, kraken.stats.realized);
	const series: Series[] =
		rate === null
			? []
			: [
					{ label: "PUMP.FUN", color: PUMP_SERIES, points: cumulativePoints(pump.stats, rate) },
					{ label: "KRAKEN", color: KRAKEN_SERIES, points: cumulativePoints(kraken.stats) },
				];
	const rateText = solUsd ? `SOL/USD $${Number(solUsd.price).toFixed(2)} at ${clockTime(solUsd.at)}` : null;
	return (
		<>
			<div className="verdict-pair">
				<Verdict label={`PUMP.FUN VERDICT (${mode})`} stats={pump.stats} />
				<Verdict label={`KRAKEN VERDICT (${mode})`} stats={kraken.stats} />
			</div>
			<p className="note">Each desk runs its own strategy, so there is no blended verdict.</p>
			<div className="tiles">
				<div className="tile hero">
					<div className="k">TOTAL REALIZED (USD)</div>
					<div className={`v pol ${polarity(combined.totalUsd ?? 0)}`}>
						{combined.totalUsd === null ? "--" : usd(combined.totalUsd)}
					</div>
					<div className="s">{combined.note ?? rateText}</div>
				</div>
				<div className="tile">
					<div className="k">PUMP.FUN REALIZED</div>
					<div className={`v pol ${polarity(pump.stats.realized)}`}>{sol(pump.stats.realized)} SOL</div>
					<div className="s">
						{rate === null ? "no SOL/USD price" : `${usd(pump.stats.realized * rate)} at the current rate`}
					</div>
				</div>
				<div className="tile">
					<div className="k">KRAKEN REALIZED</div>
					<div className={`v pol ${polarity(kraken.stats.realized)}`}>{usd(kraken.stats.realized)}</div>
					<div className="s">{kraken.stats.trades} closed trades</div>
				</div>
			</div>
			{view === "charts" ? (
				<div className="charts single">
					<Chart
						title="CUMULATIVE PNL, BOTH DESKS (USD)"
						subtitle={
							rateText
								? `pump.fun converted at the current ${rateText}`
								: "Needs a SOL/USD price; each desk's tab shows its own curve"
						}
						empty={rateText ? "No closed trades yet." : "No SOL/USD price yet."}
						hasData={series.some((item) => item.points.length > 0)}
						mode="x"
						crosshair
						legend={[
							{ label: "PUMP.FUN", color: PUMP_SERIES },
							{ label: "KRAKEN", color: KRAKEN_SERIES },
						]}
						draw={(ctx, box) => drawLines(ctx, series, box, colors, { x: clockTime, y: usdAxis })}
					/>
				</div>
			) : (
				<TradesTable
					trades={[...pump.trades, ...kraken.trades]}
					unitLabel="PNL"
					text={(row) => (row.desk === "KRAKEN" ? usd(row.pnl) : `${sol(row.pnl)} SOL`)}
				/>
			)}
		</>
	);
}

type TabId = "pump" | "kraken" | "combined";

const TABS: { id: TabId; label: string }[] = [
	{ id: "pump", label: "PUMP.FUN" },
	{ id: "kraken", label: "KRAKEN" },
	{ id: "combined", label: "COMBINED" },
];

interface Props {
	state: GameState;
	onClose: () => void;
}

export function Analytics({ state, onClose }: Props) {
	const [view, setView] = useState<"charts" | "table">("charts");
	const [tab, setTab] = useState<TabId>(() => activeDesk(state));
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
	const kraken = snapshot.kraken;
	const shown: TabId = kraken ? tab : "pump";
	const colors = chartColors(screenTier(state));
	const mode = snapshot.synthetic ? "SYNTHETIC DEMO" : snapshot.mode.toUpperCase();
	const pump = pumpReport(snapshot);

	return (
		<div className="modal analytics-modal">
			<div ref={dialogRef} className="terminal" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
				<div className="sheet-head">
					<h3 id="analytics-title">ANALYTICS TERMINAL</h3>
					<span className="badge badge-sim">{mode}</span>
					<span className="spacer" />
					<div className="segmented" role="tablist" aria-label="Desk">
						{TABS.map((item) => (
							<button
								key={item.id}
								type="button"
								role="tab"
								aria-selected={shown === item.id}
								className={`btn ${shown === item.id ? "on" : ""}`}
								disabled={item.id !== "pump" && !kraken}
								title={item.id !== "pump" && !kraken ? "The Kraken desk is off" : undefined}
								onClick={() => setTab(item.id)}
							>
								{item.label}
							</button>
						))}
					</div>
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

				{shown === "combined" && kraken ? (
					<CombinedView
						pump={pump}
						kraken={krakenReport(kraken)}
						solUsd={kraken.solUsd}
						view={view}
						mode={mode}
						colors={colors}
					/>
				) : shown === "kraken" && kraken ? (
					<DeskView report={krakenReport(kraken)} view={view} mode={mode} colors={colors} />
				) : (
					<DeskView report={pump} view={view} mode={mode} colors={colors} />
				)}
				<p className="foot">
					Expectancy is the mean PnL per closed trade; the 90% interval is mean +/- 1.645 standard errors. Each
					desk's verdict waits for 50 closes in this mode.
				</p>
			</div>
		</div>
	);
}
