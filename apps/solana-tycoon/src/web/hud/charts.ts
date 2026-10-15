import type { ExperimentVerdict } from "../../shared/stats";

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ChartColors {
	mark: string;
	positive: string;
	negative: string;
	grid: string;
	text: string;
	muted: string;
	surface: string;
}

// Screen geometry of a drawn mark, for hover and keyboard readouts.
export interface Hit {
	cx: number;
	cy: number;
	label: string;
	value: string;
}

export interface Format {
	x?: (value: number) => string;
	y?: (value: number) => string;
}

const AXIS_FONT = '16px "VT323", ui-monospace, monospace';
const LEFT_GUTTER = 46;
const BOTTOM_GUTTER = 20;
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

export function scaleLinear(domain: [number, number], range: [number, number]): (value: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	if (d1 === d0) return () => (r0 + r1) / 2;
	return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

function niceStep(raw: number): number {
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const fraction = raw / magnitude;
	const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
	return nice * magnitude;
}

export function niceTicks(min: number, max: number, count: number): number[] {
	if (max === min) return [min, min + 1];
	const step = niceStep((max - min) / count);
	const decimals = Math.max(0, -Math.floor(Math.log10(step)));
	const start = Math.floor(min / step);
	const end = Math.ceil(max / step);
	const ticks: number[] = [];
	for (let i = start; i <= end; i++) ticks.push(Number((i * step).toFixed(decimals)) || 0);
	return ticks;
}

export function verdictCopy(verdict: ExperimentVerdict): { text: string; tone: "neutral" | "bad" | "good" } {
	if (verdict.kind === "collecting")
		return { text: `Need ${verdict.needed} more closes for a verdict`, tone: "neutral" };
	if (verdict.kind === "losing") return { text: "Strategy is losing money", tone: "bad" };
	return { text: "No evidence of losing money (90% CI)", tone: "good" };
}

function plotArea(box: Box): Box {
	return { x: box.x + LEFT_GUTTER, y: box.y + 6, w: box.w - LEFT_GUTTER - 8, h: box.h - BOTTOM_GUTTER - 10 };
}

const defaultFormat = (value: number) => {
	const abs = Math.abs(value);
	if (abs >= 1000) return `${(value / 1000).toFixed(1)}K`;
	return abs >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toPrecision(2);
};

function yAxis(
	ctx: CanvasRenderingContext2D,
	area: Box,
	ticks: number[],
	scale: (v: number) => number,
	colors: ChartColors,
	format: (v: number) => string,
): void {
	ctx.font = AXIS_FONT;
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	for (const tick of ticks) {
		const y = Math.round(scale(tick)) + 0.5;
		ctx.strokeStyle = colors.grid;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(area.x, y);
		ctx.lineTo(area.x + area.w, y);
		ctx.stroke();
		ctx.fillStyle = colors.muted;
		ctx.fillText(format(tick), area.x - 6, y);
	}
}

function xLabels(
	ctx: CanvasRenderingContext2D,
	area: Box,
	items: { x: number; text: string }[],
	colors: ChartColors,
): void {
	ctx.font = AXIS_FONT;
	ctx.fillStyle = colors.muted;
	ctx.textBaseline = "top";
	let lastRight = Number.NEGATIVE_INFINITY;
	items.forEach((item, i) => {
		const width = ctx.measureText(item.text).width;
		ctx.textAlign = i === 0 ? "left" : i === items.length - 1 ? "right" : "center";
		const left = ctx.textAlign === "left" ? item.x : ctx.textAlign === "right" ? item.x - width : item.x - width / 2;
		if (left < lastRight + 8) return;
		ctx.fillText(item.text, item.x, area.y + area.h + 6);
		lastRight = left + width;
	});
}

// Rect with 4px rounding on the data end only; the baseline end stays square.
function bar(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	dataEnd: "top" | "bottom" | "right",
): void {
	const r = Math.min(RADIUS, Math.abs(dataEnd === "right" ? w : h) / 2, (dataEnd === "right" ? h : w) / 2);
	ctx.beginPath();
	if (dataEnd === "top") ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
	else if (dataEnd === "bottom") ctx.roundRect(x, y, w, h, [0, 0, r, r]);
	else ctx.roundRect(x, y, w, h, [0, r, r, 0]);
	ctx.fill();
}

function extent(values: number[], includeZero: boolean): [number, number] {
	let min = Math.min(...values);
	let max = Math.max(...values);
	if (includeZero) {
		min = Math.min(0, min);
		max = Math.max(0, max);
	}
	return [min, max];
}

export function drawLine(
	ctx: CanvasRenderingContext2D,
	pts: { x: number; y: number }[],
	box: Box,
	colors: ChartColors,
	format: Format = {},
): Hit[] {
	if (pts.length === 0) return [];
	const area = plotArea(box);
	const [y0, y1] = extent(
		pts.map((p) => p.y),
		true,
	);
	const ticks = niceTicks(y0, y1, 4);
	const sy = scaleLinear([ticks[0], ticks[ticks.length - 1]], [area.y + area.h, area.y]);
	const [x0, x1] = extent(
		pts.map((p) => p.x),
		false,
	);
	const sx = scaleLinear([x0, x1], [area.x, area.x + area.w]);
	const fy = format.y ?? defaultFormat;
	const fx = format.x ?? defaultFormat;
	yAxis(ctx, area, ticks, sy, colors, fy);

	const screen = pts.map((p) => ({ cx: pts.length === 1 ? area.x + area.w / 2 : sx(p.x), cy: sy(p.y) }));
	ctx.globalAlpha = 0.1;
	ctx.fillStyle = colors.mark;
	ctx.beginPath();
	ctx.moveTo(screen[0].cx, sy(0));
	for (const p of screen) ctx.lineTo(p.cx, p.cy);
	ctx.lineTo(screen[screen.length - 1].cx, sy(0));
	ctx.closePath();
	ctx.fill();
	ctx.globalAlpha = 1;

	ctx.strokeStyle = colors.mark;
	ctx.lineWidth = 2;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.beginPath();
	for (const [i, p] of screen.entries()) {
		if (i === 0) ctx.moveTo(p.cx, p.cy);
		else ctx.lineTo(p.cx, p.cy);
	}
	ctx.stroke();

	const end = screen[screen.length - 1];
	ctx.fillStyle = colors.surface;
	ctx.beginPath();
	ctx.arc(end.cx, end.cy, 6, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = colors.mark;
	ctx.beginPath();
	ctx.arc(end.cx, end.cy, 4, 0, Math.PI * 2);
	ctx.fill();
	ctx.font = AXIS_FONT;
	ctx.fillStyle = colors.text;
	ctx.textAlign = "right";
	ctx.textBaseline = "bottom";
	ctx.fillText(fy(pts[pts.length - 1].y), end.cx - 8, end.cy - 6);

	xLabels(
		ctx,
		area,
		[
			{ x: screen[0].cx, text: fx(pts[0].x) },
			{ x: end.cx, text: fx(pts[pts.length - 1].x) },
		],
		colors,
	);
	return pts.map((p, i) => ({ cx: screen[i].cx, cy: screen[i].cy, label: fx(p.x), value: fy(p.y) }));
}

export interface Series {
	label: string;
	color: string;
	points: { x: number; y: number }[];
}

// Several series on one shared y-axis: 2px lines, an end dot, and a direct label per series in text ink.
// Hits are ordered by x so arrow keys walk through time.
export function drawLines(
	ctx: CanvasRenderingContext2D,
	series: readonly Series[],
	box: Box,
	colors: ChartColors,
	format: Format = {},
): Hit[] {
	const drawn = series.filter((item) => item.points.length > 0);
	if (drawn.length === 0) return [];
	const fy = format.y ?? defaultFormat;
	const fx = format.x ?? defaultFormat;
	ctx.font = AXIS_FONT;
	const labelOf = (item: Series) => `${item.label} ${fy(item.points[item.points.length - 1].y)}`;
	const labelWidth = Math.min(
		box.w * 0.4,
		Math.max(...drawn.map((item) => ctx.measureText(labelOf(item)).width)) + 16,
	);
	const area = plotArea({ ...box, w: box.w - labelWidth });
	const all = drawn.flatMap((item) => item.points);
	const [y0, y1] = extent(
		all.map((p) => p.y),
		true,
	);
	const ticks = niceTicks(y0, y1, 4);
	const sy = scaleLinear([ticks[0], ticks[ticks.length - 1]], [area.y + area.h, area.y]);
	const [x0, x1] = extent(
		all.map((p) => p.x),
		false,
	);
	const sx = x0 === x1 ? () => area.x + area.w / 2 : scaleLinear([x0, x1], [area.x, area.x + area.w]);
	yAxis(ctx, area, ticks, sy, colors, fy);

	const hits: Hit[] = [];
	const ends: { cy: number; cx: number; text: string }[] = [];
	for (const item of drawn) {
		const screen = item.points.map((p) => ({ cx: sx(p.x), cy: sy(p.y) }));
		ctx.strokeStyle = item.color;
		ctx.lineWidth = 2;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.beginPath();
		for (const [i, p] of screen.entries()) {
			if (i === 0) ctx.moveTo(p.cx, p.cy);
			else ctx.lineTo(p.cx, p.cy);
		}
		ctx.stroke();
		const end = screen[screen.length - 1];
		ctx.fillStyle = colors.surface;
		ctx.beginPath();
		ctx.arc(end.cx, end.cy, 6, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = item.color;
		ctx.beginPath();
		ctx.arc(end.cx, end.cy, 4, 0, Math.PI * 2);
		ctx.fill();
		ends.push({ cx: end.cx, cy: end.cy, text: labelOf(item) });
		item.points.forEach((p, i) => {
			hits.push({ cx: screen[i].cx, cy: screen[i].cy, label: `${item.label} ${fx(p.x)}`, value: fy(p.y) });
		});
	}

	// Direct labels sit right of each end dot, nudged apart when two ends are close.
	ends.sort((a, b) => a.cy - b.cy);
	for (let i = 1; i < ends.length; i++) ends[i].cy = Math.max(ends[i].cy, ends[i - 1].cy + 16);
	ctx.font = AXIS_FONT;
	ctx.fillStyle = colors.text;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	for (const end of ends) ctx.fillText(end.text, end.cx + 10, end.cy);

	xLabels(
		ctx,
		area,
		[
			{ x: sx(x0), text: fx(x0) },
			{ x: sx(x1), text: fx(x1) },
		],
		colors,
	);
	return hits.sort((a, b) => a.cx - b.cx);
}

const NO_RATE_NOTE = "No SOL/USD price; pump.fun shown in SOL";

// Realized PnL across both desks in USD. Without a SOL/USD rate there is no honest total.
export function combinedRealizedUsd(
	pumpRealizedSol: number,
	solUsd: number | null,
	krakenRealizedUsd: number,
): { totalUsd: number | null; note: string | null } {
	if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return { totalUsd: null, note: NO_RATE_NOTE };
	return { totalUsd: pumpRealizedSol * solUsd + krakenRealizedUsd, note: null };
}

export interface BarOptions {
	polarity?: boolean;
	horizontal?: boolean;
	valueLabels?: boolean;
	format?: (value: number) => string;
}

export function drawBars(
	ctx: CanvasRenderingContext2D,
	values: number[],
	labels: string[],
	box: Box,
	colors: ChartColors,
	options: BarOptions = {},
): Hit[] {
	if (values.length === 0) return [];
	const format = options.format ?? defaultFormat;
	const colorOf = (v: number) => (options.polarity ? (v >= 0 ? colors.positive : colors.negative) : colors.mark);
	ctx.font = AXIS_FONT;

	if (options.horizontal) {
		const labelWidth = Math.min(box.w * 0.4, Math.max(...labels.map((label) => ctx.measureText(label).width)) + 10);
		const area = { x: box.x + labelWidth, y: box.y + 4, w: box.w - labelWidth - 44, h: box.h - 8 };
		const max = Math.max(1, ...values);
		const sx = scaleLinear([0, max], [area.x, area.x + area.w]);
		const band = area.h / values.length;
		const thickness = Math.min(MAX_BAR, band - GAP);
		ctx.strokeStyle = colors.grid;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(area.x + 0.5, area.y);
		ctx.lineTo(area.x + 0.5, area.y + area.h);
		ctx.stroke();
		return values.map((value, i) => {
			const cy = area.y + band * i + band / 2;
			const width = Math.max(value > 0 ? 2 : 0, sx(value) - area.x);
			ctx.fillStyle = colorOf(value);
			if (width > 0) bar(ctx, area.x + 1, cy - thickness / 2, width, thickness, "right");
			ctx.fillStyle = colors.text;
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			ctx.fillText(labels[i], area.x - 8, cy);
			if (options.valueLabels !== false) {
				ctx.fillStyle = colors.text;
				ctx.textAlign = "left";
				ctx.fillText(format(value), area.x + width + 6, cy);
			}
			return { cx: area.x + width / 2, cy, label: labels[i], value: format(value) };
		});
	}

	const area = plotArea(box);
	const [lo, hi] = extent(values, true);
	const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi, 4);
	const sy = scaleLinear([ticks[0], ticks[ticks.length - 1]], [area.y + area.h, area.y]);
	yAxis(ctx, area, ticks, sy, colors, format);
	const band = area.w / values.length;
	const thickness = Math.max(1, Math.min(MAX_BAR, band - GAP));
	const zero = sy(0);
	const hits = values.map((value, i) => {
		const cx = area.x + band * i + band / 2;
		const top = sy(value);
		const height = Math.abs(zero - top);
		ctx.fillStyle = colorOf(value);
		if (height > 0)
			bar(ctx, cx - thickness / 2, Math.min(zero, top), thickness, height, value >= 0 ? "top" : "bottom");
		return { cx, cy: top, label: labels[i], value: format(value) };
	});
	ctx.strokeStyle = colors.muted;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(area.x, Math.round(zero) + 0.5);
	ctx.lineTo(area.x + area.w, Math.round(zero) + 0.5);
	ctx.stroke();
	const every = Math.max(1, Math.ceil(values.length / 6));
	xLabels(
		ctx,
		area,
		labels.map((text, i) => ({ x: hits[i].cx, text })).filter((_, i) => i % every === 0 || i === values.length - 1),
		colors,
	);
	return hits;
}

export function drawScatter(
	ctx: CanvasRenderingContext2D,
	pts: { x: number; y: number }[],
	box: Box,
	colors: ChartColors,
	format: Format = {},
): Hit[] {
	if (pts.length === 0) return [];
	const area = plotArea(box);
	const [y0, y1] = extent(
		pts.map((p) => p.y),
		true,
	);
	const yTicks = niceTicks(y0, y1, 4);
	const sy = scaleLinear([yTicks[0], yTicks[yTicks.length - 1]], [area.y + area.h, area.y]);
	const xTicks = niceTicks(0, Math.max(...pts.map((p) => p.x), 1), 4);
	const sx = scaleLinear([0, xTicks[xTicks.length - 1]], [area.x, area.x + area.w]);
	const fy = format.y ?? defaultFormat;
	const fx = format.x ?? defaultFormat;
	yAxis(ctx, area, yTicks, sy, colors, fy);
	xLabels(
		ctx,
		area,
		xTicks.map((tick) => ({ x: sx(tick), text: fx(tick) })),
		colors,
	);
	return pts.map((p) => {
		const cx = sx(p.x);
		const cy = sy(p.y);
		ctx.fillStyle = colors.surface;
		ctx.beginPath();
		ctx.arc(cx, cy, 6, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = p.y >= 0 ? colors.positive : colors.negative;
		ctx.beginPath();
		ctx.arc(cx, cy, 4, 0, Math.PI * 2);
		ctx.fill();
		return { cx, cy, label: `held ${fx(p.x)}`, value: fy(p.y) };
	});
}
