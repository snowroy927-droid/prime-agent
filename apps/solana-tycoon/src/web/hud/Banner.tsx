import { useEffect, useRef, useState } from "react";
import type { TierId } from "../../shared/combo";

const TIER_NAMES: Record<TierId, string> = {
	terminal: "",
	ice: "ICE",
	neon: "NEON",
	gold: "GOLD RUSH",
	fever: "FEVER",
	cold: "",
};

export function Banner({ combo, tier }: { combo: number; tier: TierId }) {
	const previous = useRef(combo);
	const [shown, setShown] = useState<{ key: number; combo: number; tier: TierId } | null>(null);

	useEffect(() => {
		const last = previous.current;
		previous.current = combo;
		if (combo > last && combo >= 2) setShown((current) => ({ key: (current?.key ?? 0) + 1, combo, tier }));
	}, [combo, tier]);

	useEffect(() => {
		if (!shown) return;
		const timer = setTimeout(() => setShown(null), 1_700);
		return () => clearTimeout(timer);
	}, [shown]);

	if (!shown) return null;
	return (
		<output key={shown.key} className="banner show" aria-live="polite">
			<div className="big">{shown.combo >= 5 ? "FEVER!" : `COMBO x${shown.combo}`}</div>
			{TIER_NAMES[shown.tier] ? <div className="small">{TIER_NAMES[shown.tier]}</div> : null}
		</output>
	);
}
