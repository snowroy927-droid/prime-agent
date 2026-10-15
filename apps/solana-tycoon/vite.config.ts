import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		outDir: "dist/web",
		emptyOutDir: true,
		// The bridge CSP allows fonts from 'self' only, so never inline assets as data: URIs.
		assetsInlineLimit: 0,
	},
});
