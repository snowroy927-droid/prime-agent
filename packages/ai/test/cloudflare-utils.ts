import { CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL } from "../src/providers/cloudflare.js";
import type { Model } from "../src/types.js";

export function hasCloudflareWorkersAICredentials(): boolean {
	return !!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_ACCOUNT_ID;
}

export function hasCloudflareAiGatewayCredentials(): boolean {
	return (
		!!process.env.CLOUDFLARE_API_KEY && !!process.env.CLOUDFLARE_ACCOUNT_ID && !!process.env.CLOUDFLARE_GATEWAY_ID
	);
}

// models.dev no longer lists workers-ai/* routes for Cloudflare AI Gateway, so the
// generated catalog has no /compat model; this fixture keeps that code path under test.
export const cloudflareAiGatewayWorkersAiModel: Model<"openai-completions"> = {
	id: "workers-ai/@cf/moonshotai/kimi-k2.6",
	name: "Kimi K2.6",
	api: "openai-completions",
	provider: "cloudflare-ai-gateway",
	baseUrl: CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
	compat: { sendSessionAffinityHeaders: true },
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
	contextWindow: 256000,
	maxTokens: 256000,
};
