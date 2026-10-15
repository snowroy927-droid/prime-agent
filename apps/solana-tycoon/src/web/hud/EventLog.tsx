import type { LogLine } from "../../shared/types";
import { clockTime } from "./format";

export function EventLog({ lines }: { lines: LogLine[] }) {
	const recent = lines.slice(-8);
	return (
		<div className="log" role="log" aria-live="polite" aria-label="Event log">
			{recent.length === 0 ? <div className="dim">Engine events appear here.</div> : null}
			{recent.map((line, index) => (
				<div
					key={`${line.at}-${index}`}
					className={line.level === "error" ? "e" : line.level === "warn" ? "w" : ""}
				>
					<span className="dim">{clockTime(line.at)}</span> {line.message}
				</div>
			))}
		</div>
	);
}
