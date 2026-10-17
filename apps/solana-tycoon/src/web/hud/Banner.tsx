import type { TierId } from "../../shared/combo";

const TIER_NAMES: Record<TierId, string> = {
	terminal: "",
	ice: "ICE",
	neon: "NEON",
	gold: "GOLD RUSH",
	fever: "FEVER",
	cold: "",
};

export function Banner({ banner, tier }: { banner: { id: number; text: string } | null; tier: TierId }) {
	if (!banner) return null;
	return (
		<output key={banner.id} className="banner show" aria-live="polite">
			<div className="big">{banner.text}</div>
			{TIER_NAMES[tier] ? <div className="small">{TIER_NAMES[tier]}</div> : null}
		</output>
	);
}
