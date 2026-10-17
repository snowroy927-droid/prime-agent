import { useCallback, useEffect, useRef, useState } from "react";

export const HOLD_MS = 1_500;

export interface HoldController {
	activeId: string | null;
	progress: number;
	start: (id: string, onConfirm: () => void) => void;
	cancel: (id?: string) => void;
}

// One hold at a time: the kill switch and risky snipes confirm after a 1.5s press.
export function useHold(): HoldController {
	const [activeId, setActiveId] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const active = useRef<{ id: string; startedAt: number; onConfirm: () => void } | null>(null);
	const frame = useRef<number | null>(null);

	const stop = useCallback(() => {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		active.current = null;
		setActiveId(null);
		setProgress(0);
	}, []);

	const step = useCallback(() => {
		const current = active.current;
		if (!current) return;
		const value = Math.min(1, (performance.now() - current.startedAt) / HOLD_MS);
		setProgress(value);
		if (value >= 1) {
			const confirm = current.onConfirm;
			stop();
			confirm();
			return;
		}
		frame.current = requestAnimationFrame(step);
	}, [stop]);

	const start = useCallback(
		(id: string, onConfirm: () => void) => {
			if (active.current?.id === id) return;
			stop();
			active.current = { id, startedAt: performance.now(), onConfirm };
			setActiveId(id);
			frame.current = requestAnimationFrame(step);
		},
		[step, stop],
	);

	const cancel = useCallback(
		(id?: string) => {
			if (!active.current || (id !== undefined && active.current.id !== id)) return;
			stop();
		},
		[stop],
	);

	useEffect(() => stop, [stop]);
	return { activeId, progress, start, cancel };
}
