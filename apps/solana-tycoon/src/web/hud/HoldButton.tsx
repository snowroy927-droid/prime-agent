import type { CSSProperties, ReactNode } from "react";
import type { HoldController } from "./useHold";

interface Props {
	id: string;
	hold: HoldController;
	needsHold: boolean;
	onConfirm: () => void;
	className: string;
	disabled?: boolean;
	label: string;
	children: ReactNode;
}

// Clicks when no confirmation is needed; otherwise fills over 1.5s while pressed.
export function HoldButton({ id, hold, needsHold, onConfirm, className, disabled, label, children }: Props) {
	const progress = hold.activeId === id ? hold.progress : 0;
	const style = { "--p": progress } as CSSProperties;
	if (!needsHold) {
		return (
			<button type="button" className={className} disabled={disabled} aria-label={label} onClick={onConfirm}>
				{children}
			</button>
		);
	}
	return (
		<button
			type="button"
			className={`${className} hold`}
			style={style}
			disabled={disabled}
			aria-label={`${label} (hold 1.5 seconds)`}
			onPointerDown={() => hold.start(id, onConfirm)}
			onPointerUp={() => hold.cancel(id)}
			onPointerLeave={() => hold.cancel(id)}
			onPointerCancel={() => hold.cancel(id)}
			onKeyDown={(event) => {
				if ((event.key === "Enter" || event.key === " ") && !event.repeat) hold.start(id, onConfirm);
			}}
			onKeyUp={(event) => {
				if (event.key === "Enter" || event.key === " ") hold.cancel(id);
			}}
		>
			{children}
		</button>
	);
}
