import { useEffect, useRef, useState } from "react";
import { ACTION_LABELS, type ActionId } from "./keybindings";
import type { Section } from "./settingsFields";

interface Props {
	title: string;
	sections: Section[];
	settings: object;
	auto: { key: string; label: string; value: boolean };
	bindings: Record<ActionId, string>;
	reducedMotion: boolean;
	onSave: (patch: Record<string, unknown>) => Promise<string | null>;
	onBindings: (bindings: Record<ActionId, string>) => void;
	onReducedMotion: (value: boolean) => void;
	onClose: () => void;
}

function read(settings: object, path: string): unknown {
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
	title,
	sections,
	settings,
	auto,
	bindings,
	reducedMotion,
	onSave,
	onBindings,
	onReducedMotion,
	onClose,
}: Props) {
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			sections.flatMap((section) => section.fields).map((field) => [field.path, toText(read(settings, field.path))]),
		),
	);
	const [autoOn, setAutoOn] = useState(auto.value);
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
		const patch: Record<string, unknown> = { [auto.key]: autoOn };
		for (const field of sections.flatMap((section) => section.fields)) {
			const text = values[field.path].trim();
			if (field.kind === "boolean") {
				assign(patch, field.path, text === "true");
			} else if (field.kind === "number") {
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
					<h3 id="settings-title">{title}</h3>
					<button type="button" className="btn" onClick={onClose}>
						CLOSE
					</button>
				</div>
				<label className="toggle">
					<input type="checkbox" checked={autoOn} onChange={(event) => setAutoOn(event.target.checked)} />
					<span>{auto.label}</span>
				</label>
				{sections.map((section) => (
					<fieldset key={section.title} className="form-section">
						<legend>{section.title}</legend>
						<div className="form">
							{section.fields.map((field) => {
								const ref = first ? firstInput : undefined;
								first = false;
								if (field.kind === "boolean") {
									return (
										<div key={field.path} className="field">
											<label className="toggle" htmlFor={`f-${field.path}`}>
												<input
													id={`f-${field.path}`}
													type="checkbox"
													checked={values[field.path] === "true"}
													onChange={(event) =>
														setValues((current) => ({
															...current,
															[field.path]: String(event.target.checked),
														}))
													}
												/>
												<span>{field.label}</span>
											</label>
											<span className="hint">{field.hint}</span>
										</div>
									);
								}
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
