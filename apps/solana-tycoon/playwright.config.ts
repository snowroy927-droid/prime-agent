import { defineConfig, devices } from "@playwright/test";

const PORT = 7788;
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
	testDir: "e2e",
	outputDir: "test-results/playwright",
	timeout: 180_000,
	// The demo is one timeline per server start, so tests share it in order.
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		...devices["Desktop Chrome"],
		launchOptions: {
			executablePath,
			// Software WebGL so the office renders in headless CI without a GPU.
			args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
		},
	},
	webServer: {
		command: `npm run build:web && npx tsx src/engine/main.ts --demo --speed 4 --port ${PORT}`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: "pipe",
	},
});
