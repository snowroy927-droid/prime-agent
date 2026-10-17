import type { Clock } from "../clock";
import { backoffDelay } from "../feed/backoff";

export type HttpGet = (url: string) => Promise<{ status: number; body: string }>;

export class KrakenRestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "KrakenRestError";
	}
}

export interface KrakenRestLike {
	assetPairs(): Promise<unknown>;
	ticker(pairs: readonly string[]): Promise<unknown>;
	ohlc(pair: string): Promise<unknown>;
}

// A hung connection must not stall the serial request queue, so every request has a deadline.
export function makeFetchGet(timeoutMs = 10_000): HttpGet {
	return async (url) => {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		return { status: response.status, body: await response.text() };
	};
}

export const fetchGet: HttpGet = makeFetchGet();

const DEFAULT_BASE_URL = "https://api.kraken.com";
const MIN_SPACING_MS = 1_000;
const MAX_ATTEMPTS = 4;
const MAX_TICKER_PAIRS = 100;

function cryptoUnit(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

// Public REST client. Every request, retries included, is spaced at least MIN_SPACING_MS apart because Kraken
// limits public endpoints per IP.
export class KrakenRest implements KrakenRestLike {
	private nextAt = 0;
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly deps: { get: HttpGet; clock: Clock; baseUrl?: string; jitterUnit?: () => number }) {}

	assetPairs(): Promise<unknown> {
		return this.enqueue("/0/public/AssetPairs");
	}

	async ticker(pairs: readonly string[]): Promise<unknown> {
		if (pairs.length > MAX_TICKER_PAIRS) {
			throw new KrakenRestError(`Ticker takes at most ${MAX_TICKER_PAIRS} pairs per call`);
		}
		return this.enqueue(`/0/public/Ticker?pair=${pairs.map(encodeURIComponent).join(",")}`);
	}

	ohlc(pair: string): Promise<unknown> {
		return this.enqueue(`/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=1`);
	}

	private enqueue(path: string): Promise<unknown> {
		const run = this.queue.then(() => this.request(path));
		this.queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	// Network errors, HTTP 429 and 5xx, and Kraken's rate-limit or service-busy errors inside the body are
	// retried with backoff, still spaced at least MIN_SPACING_MS apart; anything else fails at once.
	private async request(path: string): Promise<unknown> {
		const url = `${this.deps.baseUrl ?? DEFAULT_BASE_URL}${path}`;
		const jitter = this.deps.jitterUnit ?? cryptoUnit;
		let last = new KrakenRestError(`Kraken ${path} failed`);
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			if (attempt > 0) await this.deps.clock.sleep(backoffDelay(attempt - 1, jitter()));
			const wait = this.nextAt - this.deps.clock.now();
			if (wait > 0) await this.deps.clock.sleep(wait);
			this.nextAt = this.deps.clock.now() + MIN_SPACING_MS;
			let response: { status: number; body: string };
			try {
				response = await this.deps.get(url);
			} catch (error) {
				last = new KrakenRestError(error instanceof Error ? error.message : String(error));
				continue;
			}
			if (response.status === 429 || response.status >= 500) {
				last = new KrakenRestError(`Kraken ${path} returned HTTP ${response.status}`);
				continue;
			}
			if (response.status !== 200) throw new KrakenRestError(`Kraken ${path} returned HTTP ${response.status}`);
			try {
				return parseEnvelope(response.body, path);
			} catch (error) {
				if (!(error instanceof KrakenRestError) || !RETRYABLE.test(error.message)) throw error;
				last = error;
			}
		}
		throw last;
	}
}

// Kraken's own rate-limit and availability errors, reported inside a 200 response.
const RETRYABLE =
	/EAPI:Rate limit|EGeneral:Too many requests|EService:Unavailable|EService:Busy|EGeneral:Temporary lockout/;

function parseEnvelope(body: string, path: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new KrakenRestError(`Kraken ${path} returned invalid JSON`);
	}
	if (typeof parsed !== "object" || parsed === null) throw new KrakenRestError(`Kraken ${path} returned no object`);
	const envelope = parsed as { error?: unknown; result?: unknown };
	if (Array.isArray(envelope.error) && envelope.error.length > 0) {
		throw new KrakenRestError(envelope.error.map(String).join("; "));
	}
	return envelope.result;
}
