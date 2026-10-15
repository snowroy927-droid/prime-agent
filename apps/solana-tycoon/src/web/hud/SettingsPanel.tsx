import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../shared/settings";
import { ACTION_LABELS, type ActionId } from "./keybindings";

interface Props {
	settings: Settings;
	bindings: Record<ActionId, string>;
	reducedMotion: boolean;
	onSave: (patch: Record<string, unknown>) => Promise<string | null>;
	onBindings: (bindings: Record<ActionId, string>) => void;
	onReducedMotion: (value: boolean) => void;
	onClose: () => void;
}

type FieldKind = "number" | "numberList" | "textList";

interface Field {
	path: string;
	label: string;
	kind: FieldKind;
	hint: string;
}

const SECTIONS: { title: string; fields: Field[] }[] = [
	{
		title: "TRADING",
		fields: [
			{ path: "buySol", label: "BUY SIZE (SOL)", kind: "number", hint: "Max 1 SOL" },
			{ path: "maxPositions", label: "MAX POSITIONS", kind: "number", hint: "Max 10" },
			{ path: "takeProfitPct", label: "TAKE PROFIT %", kind: "number", hint: "Sell all at this gain" },
			{ path: "stopLossPct", label: "STOP LOSS %", kind: "number", hint: "Sell all at this loss" },
			{ path: "trailingStopPct", label: "TRAILING STOP %", kind: "number", hint: "0 turns it off" },
			{ path: "maxHoldMin", label: "MAX HOLD (MIN)", kind: "number", hint: "Sell after this long" },
			{
				path: "dailyLossCapSol",
				label: "DAILY LOSS CAP (SOL)",
				kind: "number",
				hint: "Auto-snipe stops until midnight",
			},
			{ path: "tiltLosses", label: "TILT AFTER LOSSES", kind: "number", hint: "Consecutive losing closes" },
			{ path: "tiltCooldownMin", label: "TILT COOLDOWN (MIN)", kind: "number", hint: "Auto-snipe pause" },
			{ path: "snipeDelaySec", label: "CHECK DELAY (S)", kind: "number", hint: "Wait before the rug check" },
			{ path: "recheckDelaysSec", label: "RE-CHECKS (S)", kind: "numberList", hint: "Comma separated, from launch" },
			{ path: "priceStaleSec", label: "STALE AFTER (S)", kind: "number", hint: "No auto exits on older prices" },
		],
	},
	{
		title: "RUG CHECK",
		fields: [
			{ path: "rug.blocklist", label: "NAME BLOCKLIST", kind: "textList", hint: "Comma separated words" },
			{
				path: "rug.serialLaunchMax",
				label: "SERIAL LAUNCH MAX",
				kind: "number",
				hint: "Coins per creator in the window",
			},
			{ path: "rug.serialWindowMin", label: "SERIAL WINDOW (MIN)", kind: "number", hint: "Creator history window" },
			{ path: "rug.maxTopHolderPct", label: "MAX TOP HOLDER %", kind: "number", hint: "Excluding the curve" },
			{ path: "rug.minHoldersInTop20", label: "MIN HOLDERS IN TOP 20", kind: "number", hint: "0 to 20" },
			{ path: "rug.minRealSol", label: "MIN REAL SOL", kind: "number", hint: "SOL already in the curve" },
		],
	},
	{
		title: "PAPER FILLS",
		fields: [
			{ path: "paper.startingBalanceSol", label: "STARTING BALANCE (SOL)", kind: "number", hint: "Paper wallet" },
			{ path: "paper.latencyMs", label: "FILL LATENCY (MS)", kind: "number", hint: "Simulated confirmation time" },
			{
				path: "paper.extraSlippageBps",
				label: "EXTRA SLIPPAGE (BPS)",
				kind: "number",
				hint: "Haircut on every fill",
			},
			{ path: "paper.priorityFeeSol", label: "PRIORITY FEE (SOL)", kind: "number", hint: "Per transaction" },
		],
	},
];

function read(settings: Settings, path: string): unknown {
	return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], settings);
}

function toText(value: unknown): string {
	return Array.isArray(value) ? value.join(", ") : String(value);
}

function assign(target: Record<string, unknown>, path: string, value: unknown): void {
	const keys = path.split(".");
	let node = target;
	for (const key of keys.slice(0, -1)) {
		node[key] = (node[key] as Record<string, unknown> | undefined) ?? {};
		node = node[key] as Record<string, unknown>;
	}
	node[keys[keys.length - 1]] = value;
}

function displayKey(key: string): string {
	return key === " " ? "SPACE" : key.length === 1 ? key.toUpperCase() : key.replace("Arrow", "");
}

export function SettingsPanel({
	settings,
	bindings,
	reducedMotion,
	onSave,
	onBindings,
	onReducedMotion,
	onClose,
}: Props) {
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			SECTIONS.flatMap((section) => section.fields).map((field) => [field.path, toText(read(settings, field.path))]),
		),
	);
	const [autoSnipe, setAutoSnipe] = useState(settings.autoSnipe);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [listening, setListening] = useState<ActionId | null>(null);
	const firstInput = useRef<HTMLInputElement | null>(null);

	useEffect(() => firstInput.current?.focus(), []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (listening) {
				event.preventDefault();
				event.stopPropagation();
				if (event.key !== "Escape") {
					const next = { ...bindings };
					const clash = (Object.keys(next) as ActionId[]).find((action) => next[action] === event.key);
					if (clash && clash !== listening) next[clash] = next[listening];
					next[listening] = event.key;
					onBindings(next);
				}
				setListening(null);
				return;
			}
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [listening, bindings, onBindings, onClose]);

	const save = async () => {
		const patch: Record<string, unknown> = { autoSnipe };
		for (const field of SECTIONS.flatMap((section) => section.fields)) {
			const text = values[field.path].trim();
			if (field.kind === "number") {
				const number = Number(text);
				if (text === "" || !Number.isFinite(number)) {
					setError(`${field.label} must be a number`);
					return;
				}
				assign(patch, field.path, number);
			} else {
				const parts = text
					.split(",")
					.map((part) => part.trim())
					.filter((part) => part !== "");
				if (field.kind === "numberList") {
					const numbers = parts.map(Number);
					if (numbers.some((number) => !Number.isFinite(number))) {
						setError(`${field.label} must be numbers separated by commas`);
						return;
					}
					assign(patch, field.path, numbers);
				} else {
					assign(patch, field.path, parts);
				}
			}
		}
		setSaving(true);
		const failure = await onSave(patch);
		setSaving(false);
		if (failure) setError(failure);
		else onClose();
	};

	let first = true;
	return (
		<div className="modal">
			<div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
				<div className="sheet-head">
					<h3 id="settings-title">SETTINGS</h3>
					<button type="button" className="btn" onClick={onClose}>
						CLOSE
					</button>
				</div>
				<label className="toggle">
					<input type="checkbox" checked={autoSnipe} onChange={(event) => setAutoSnipe(event.target.checked)} />
					<span>AUTO-SNIPE APPROVED LAUNCHES</span>
				</label>
				{SECTIONS.map((section) => (
					<fieldset key={section.title} className="form-section">
						<legend>{section.title}</legend>
						<div className="form">
							{section.fields.map((field) => {
								const ref = first ? firstInput : undefined;
								first = false;
								return (
									<div key={field.path} className="field">
										<label htmlFor={`f-${field.path}`}>{field.label}</label>
										<input
											id={`f-${field.path}`}
											ref={ref}
											type="text"
											inputMode={field.kind === "textList" ? "text" : "decimal"}
											value={values[field.path]}
											onChange={(event) =>
												setValues((current) => ({ ...current, [field.path]: event.target.value }))
											}
										/>
										<span className="hint">{field.hint}</span>
									</div>
								);
							})}
						</div>
					</fieldset>
				))}
				<div className="err" role="alert">
					{error}
				</div>
				<div className="sheet-actions">
					<button type="button" className="btn on" disabled={saving} onClick={() => void save()}>
						{saving ? "SAVING..." : "SAVE TO ENGINE"}
					</button>
				</div>
				<fieldset className="form-section">
					<legend>DISPLAY</legend>
					<label className="toggle">
						<input
							type="checkbox"
							checked={reducedMotion}
							onChange={(event) => onReducedMotion(event.target.checked)}
						/>
						<span>REDUCE MOTION (no shake, particles, or palette cycling)</span>
					</label>
				</fieldset>
				<fieldset className="form-section">
					<legend>KEYS</legend>
					<div className="keys">
						{(Object.keys(ACTION_LABELS) as ActionId[]).map((action) => (
							<div key={action} className="keyrow">
								<span>{ACTION_LABELS[action]}</span>
								<button
									type="button"
									className={`kbd ${listening === action ? "listening" : ""}`}
									onClick={() => setListening(action)}
									aria-label={`Rebind ${ACTION_LABELS[action]}, currently ${displayKey(bindings[action])}`}
								>
									{listening === action ? "PRESS" : displayKey(bindings[action])}
								</button>
							</div>
						))}
					</div>
				</fieldset>
				<p className="foot">
					Trading settings save to the engine and apply to new decisions. Display and keys stay in this browser.
				</p>
			</div>
		</div>
	);
}
