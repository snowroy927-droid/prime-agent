import type { DeskId } from "../state/store";

interface Props {
	desk: DeskId;
	krakenAvailable: boolean;
	onSelect: (desk: DeskId) => void;
}

export function DeskSwitch({ desk, krakenAvailable, onSelect }: Props) {
	return (
		<fieldset className="desk-switch" aria-label="Desk">
			<button
				type="button"
				className={`btn ${desk === "pump" ? "on" : ""}`}
				aria-pressed={desk === "pump"}
				onClick={() => onSelect("pump")}
			>
				PUMP
			</button>
			<button
				type="button"
				className={`btn ${desk === "kraken" ? "on" : ""}`}
				aria-pressed={desk === "kraken"}
				disabled={!krakenAvailable}
				title={krakenAvailable ? "Kraken paper desk on live public prices" : "The Kraken desk is off (KRAKEN=off)"}
				onClick={() => onSelect("kraken")}
			>
				KRAKEN
			</button>
		</fieldset>
	);
}
