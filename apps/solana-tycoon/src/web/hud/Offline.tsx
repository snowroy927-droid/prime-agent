import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../state/store";

interface Props {
	connection: ConnectionStatus;
	retryAt: () => number | null;
}

export function Offline({ connection, retryAt }: Props) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (connection === "open") return;
		const timer = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(timer);
	}, [connection]);
	if (connection === "open") return null;
	const next = retryAt();
	const seconds = next === null ? null : Math.max(0, Math.ceil((next - now) / 1000));
	return (
		<output className="offline">
			<div className="offline-box">
				<div className="offline-title">ENGINE OFFLINE</div>
				<div className="offline-sub">
					{connection === "connecting" || seconds === null ? "Connecting..." : `Reconnecting in ${seconds}s`}
				</div>
				<div className="offline-hint">Start the engine with npm start in apps/solana-tycoon.</div>
			</div>
		</output>
	);
}
