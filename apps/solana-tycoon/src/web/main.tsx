import "@fontsource/press-start-2p/400.css";
import "@fontsource/vt323/400.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const mount = document.getElementById("app");
if (!mount) throw new Error("Missing #app element");
createRoot(mount).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
