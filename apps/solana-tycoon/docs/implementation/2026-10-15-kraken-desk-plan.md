# SUPER C SNIPER Kraken Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kraken desk that paper-trades a momentum rule on every Kraken USD pair at real Kraken prices, beside
the unchanged pump.fun desk, with INKY in the office and PUMP.FUN / KRAKEN / COMBINED analytics.

**Architecture:**
- **Desks.** The engine process gains a `KrakenDesk` that runs alongside the existing `TradingCore`. A new `Engine`
  composes the two, and the bridge talks to `Engine`.
- **Shared logic.** Combo, tilt, stats, risk, ledger, and settings become currency-neutral. Both desks share them
  through an `Outcome` type and minor-unit amounts.
- **Kraken data.** Comes from the public REST API (pair list, candles) and WebSocket v2 (`ticker`, `ohlc` interval 1).
  Recordings and a seeded SYNTHETIC session drive the desk in demo, replay, and tests.

**Tech Stack:** unchanged from Milestone 1. Node 22, TypeScript 7.0.2, `ws` 8.22.0, zod 4.6.5, React 19.3.0, three
0.186.1, Vite 8.2.4, Vitest 5.0.3, Playwright 1.64.0, Biome 2.3.5. No new dependencies: HTTP uses Node 22's global
`fetch`.

**Spec:** `apps/solana-tycoon/docs/specs/2026-10-15-kraken-desk-design.md` (Milestone 1 spec and plan stay binding for
everything this spec does not change).

## Global Constraints

- All Milestone 1 global constraints hold: app-only changes, repo rules from `AGENTS.md`, tabs/3/120 formatting, no
  `Math.random` in `src/`, `git add` named files only, run app commands from `apps/solana-tycoon/`.
- No new npm dependencies.
- Kraken endpoints: REST base `https://api.kraken.com`, WebSocket `wss://ws.kraken.com/v2`.
- No code path reads, stores, or asks for Kraken API keys.
- USD amounts are `bigint` micro-USD inside the engine and decimal strings on the wire and in the ledger. Field names
  carry the unit: `usdMicros`, `feesUsdMicros`, `costUsdMicros`, `proceedsUsdMicros`, `pnlUsdMicros`. Quantities are
  `lots`: integer units at the pair's `lot_decimals`. Prices are decimal strings on the wire, and integers at the pair's
  `pair_decimals` inside the engine.
- Rounding always favours caution: buy cost and fees round up, sell proceeds round down, lots round down.
- REST spends at most 1 request per second and backs off on HTTP 429.
- WebSocket subscribe messages carry at most 50 symbols each.
- `PROTOCOL_VERSION` is `2`.
- `KRAKEN` env var: `on` by default, `off` disables the desk.
- Settings defaults and hard caps are copied verbatim from spec Sections 7 and 12. Hard caps: `buyUsd` ≤ 1000,
  `maxPositions` ≤ 10, pins ≤ 6 per desk.
- Copy:
  - badge `KRAKEN`;
  - tags `STALE`, `HALTED`, `WARMING UP`, `OFFLINE`;
  - analytics tabs `PUMP.FUN`, `KRAKEN`, `COMBINED`;
  - log prefix `Kraken:`.
- The pump.fun desk's trading behaviour does not change. Every existing pump.fun test passes, edited only where this
  plan renames a field.

## Review Focus

1. **Tiny or exponent-formatted prices.** A ticker sends `1.234e-8` or `0.00000001234` for a meme coin. It must parse to
   the exact integer at the pair's precision, never `NaN` or 0. Tests in Tasks 2 and 4.
2. **A held pair halts or vanishes from AssetPairs.** No automatic exits, a `HALTED` tag, and manual SELL is refused
   with `Pair halted` rather than filling at a stale price. Tests in Tasks 7 and 8.
3. **HTTP 429 during the startup candle seeding.** The REST client backs off without exceeding 1 request/s, the desk
   keeps scanning pairs that have live bars, and the pump.fun desk is unaffected. Tests in Tasks 3 and 8.
4. **No network for Kraken at startup.** The pump.fun desk starts and serves normally, and the snapshot's Kraken
   section shows `OFFLINE` with the error. Test in Task 9.
5. **KILL with open positions and in-flight buys on both desks.** Everything is sold, both desks pause, and late fills
   on either desk are sold until RESUME. Test in Task 9.

---

## File map

```
apps/solana-tycoon/
  src/shared/
    outcome.ts       Outcome type, pump and kraken adapters                         (Task 1)
    kraken.ts        Kraken domain types, settings schema, defaults, hard caps      (Task 2)
  src/engine/
    ledger/jsonl.ts  append-only JSONL mechanics shared by both ledgers             (Task 6)
    core/engine.ts   Engine: composes TradingCore and KrakenDesk                    (Task 9)
    kraken/  money.ts rest.ts pairs.ts feed.ts bars.ts rule.ts scanner.ts paper.ts ledger.ts positions.ts
             desk.ts replay.ts synthetic.ts
  src/web/
    hud/     KrakenRadar.tsx KrakenDesk.tsx DeskSwitch.tsx                          (Task 11)
    scene/   INKY in office.ts, cast/defs.ts, monitors.ts, director.ts              (Task 12)
  scripts/make-demo.ts   also writes fixtures/kraken-demo-session.jsonl             (Task 10)
  test/      kraken-*.test.ts per module, outcome.test.ts, engine.test.ts
```

---

### Task 1: Currency-neutral outcomes, stats, risk, and protocol v2

**Files:**
- Create: `src/shared/outcome.ts`
- Modify: `src/shared/combo.ts`, `src/shared/tilt.ts`, `src/shared/stats.ts`, `src/shared/progression.ts`,
  `src/shared/protocol.ts`, `src/shared/types.ts`, `src/engine/risk/guard.ts`, `src/engine/core/tradingCore.ts`,
  `src/web/state/store.ts`, `src/web/hud/Analytics.tsx`, `src/web/hud/Positions.tsx`, `src/web/hud/TopBar.tsx`,
  `src/web/scene/director.ts`, and the tests that construct these types.
- Test: `test/outcome.test.ts`, plus the existing suites.

**Interfaces:**
- Produces:

```ts
// outcome.ts
export interface Outcome { pnl: bigint; openedAt: number; closedAt: number; reason: ExitReason } // pnl in minor units
export function pumpOutcome(trade: ClosedTrade): Outcome;
// combo.ts / tilt.ts / progression.ts: generic cores; existing ClosedTrade functions become one-line wrappers
export function comboCountOf(outcomes: readonly Outcome[]): number;
export function activeTierOf(outcomes: readonly Outcome[], now: number): TierId;
export function consecutiveLossesOf(outcomes: readonly Outcome[]): number;
export function tiltUntilOf(outcomes: readonly Outcome[], tiltLosses: number, tiltCooldownMin: number): number | null;
export function peakCumulative(outcomes: readonly Outcome[]): bigint;
// stats.ts
export function computeStatsOf(outcomes: readonly Outcome[], tzOffsetMin: number, unitsPerWhole: number): Stats;
// guard.ts
export interface RiskLimits { maxPositions: number; auto: boolean; dailyLossCap: bigint; tiltLosses: number;
	tiltCooldownMin: number }
export interface RiskCopy { autoOff: string; notApproved: string; rejectedHold: string }
export type Signal = "approved" | "rejected" | null;
export class RiskGuard {
	constructor(deps: { clock: Clock; limits: () => RiskLimits; copy: RiskCopy; tzOffsetMin?: () => number });
	state(outcomes: readonly Outcome[]): RiskState;
	canOpen(kind: OpenKind, outcomes: readonly Outcome[], openCount: number,
		opts: { holdConfirmed: boolean; signal: Signal }): { ok: true } | { ok: false; reason: string };
	setPaused(paused: boolean, reason: string | null): void;
}
export function pumpLimits(s: Settings): RiskLimits;
export const PUMP_RISK_COPY: RiskCopy; // "Auto-snipe off", "Not approved", "Hold to snipe a rejected coin"
```

- **Renames.** `PROTOCOL_VERSION` becomes 2 because these change the wire format:
  - `Stats` amount fields drop the `Sol` suffix and hold whole units of the desk's currency: `avgWin`, `avgLoss`,
    `expectancy`, `expectancyCi90`, `best`, `worst`, `realized`, `cumulative: { at, value }[]`,
    `holds: { holdSec, pnl }[]`.
  - `RiskState.autoSnipe` becomes `auto`.
  - `RiskState.dailyPnlLamports` becomes `dailyPnl`: a decimal string in the desk's minor units.
- **Pump.fun mapping.**
  - `TradingCore` builds its guard with `pumpLimits` and `PUMP_RISK_COPY`.
  - It maps verdict `approved` to `"approved"`, `rejected` to `"rejected"`, and anything else to `null`.
  - It passes `closes.map(pumpOutcome)`.

- [ ] **Step 1: Write failing tests** in `test/outcome.test.ts`:
  - `computeStatsOf` over micro-USD outcomes with `unitsPerWhole` 1_000_000 gives `realized` 1.5 for pnls of +2.0
    and -0.5 USD.
  - `tiltUntilOf` with 3 losses and a 30 min cooldown returns the last close + 1_800_000.
  - `RiskGuard` built with `{ autoOff: "Auto-buy off", notApproved: "Not eligible", rejectedHold: "Hold to buy a pair
    the rule skipped" }` returns those reasons.
  - `pumpOutcome` keeps `pnl` equal to `BigInt(pnlLamports)`.
- [ ] **Step 2: Run** `npx vitest run test/outcome.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement**, then apply the renames across engine, web, and tests.
- [ ] **Step 4: Run** `npx vitest run` and `npm run check`. Expected: all pass, and no pump.fun test changes beyond the
  field renames.
- [ ] **Step 5: Commit**: `refactor(solana-tycoon): make outcomes, stats and risk currency-neutral`.

### Task 2: Kraken types, settings, and money math

**Files:**
- Create: `src/shared/kraken.ts`, `src/engine/kraken/money.ts`
- Modify: `src/engine/settingsStore.ts`
- Test: `test/kraken-money.test.ts`, `test/kraken-settings.test.ts`

**Interfaces:**
- Consumes: `Outcome` (Task 1), `ExitReason`, `Mode`, `FeedStatus`, `RiskState`, `Stats`.
- Produces:

```ts
// shared/kraken.ts
export interface KrakenPair { pair: string; wsname: string; symbol: string; priceDecimals: number; lotDecimals: number;
	ordermin: string | null; costmin: string | null }
export type RuleStatus = "eligible" | "warming_up" | "low_volume" | "wide_spread" | "small_move" | "not_rising"
	| "no_volume_surge" | "held" | "cooldown";
export interface Mover { pair: string; symbol: string; last: string; bid: string; ask: string; change5m: number | null;
	change15m: number | null; change60m: number | null; volumeUsd24h: number; spreadPct: number; status: RuleStatus;
	reason: string }
export interface KrakenFill { id: string; positionId: string; mode: Mode; pair: string; symbol: string; side: Side;
	usdMicros: string; lots: string; feesUsdMicros: string; ts: number }
export interface KrakenClosedTrade { positionId: string; mode: Mode; pair: string; symbol: string; costUsdMicros: string;
	proceedsUsdMicros: string; pnlUsdMicros: string; pnlPct: number; reason: ExitReason; openedAt: number; closedAt: number }
export interface KrakenPosition { id: string; mode: Mode; pair: string; symbol: string; openedAt: number;
	costUsdMicros: string; proceedsUsdMicros: string; lots: string; valueUsdMicros: string | null; pnlPct: number | null;
	peakPnlPct: number; price: string | null; priceAt: number | null; stale: boolean; halted: boolean; pendingOrder: boolean }
export interface ScanStats { moversPerHour: number[]; skipReasons: { reason: string; count: number }[] }
export const KrakenSettingsSchema: z.ZodType<KrakenSettings>; // strictObject, every key in spec Section 12
export type KrakenSettings = z.infer<typeof KrakenSettingsSchema>;
export const DEFAULT_KRAKEN_SETTINGS: KrakenSettings;           // spec Section 12 values verbatim
export const KRAKEN_HARD_LIMITS: { buyUsdMax: 1000; maxPositionsMax: 10; pinsMax: 6 };
export function applyKrakenSettingsPatch(current: KrakenSettings, patch: unknown):
	{ ok: true; settings: KrakenSettings } | { ok: false; error: string };
export function krakenOutcome(trade: KrakenClosedTrade): Outcome;
export interface KrakenOrderUpdate { id: string; positionId: string; pair: string; symbol: string; side: Side;
	status: OrderStatus; source: "auto" | "manual" | "exit"; error?: string; at: number }
export interface KrakenSnapshot { error: string | null; feed: { status: FeedStatus; dropped: number;
	reconnectAt: number | null }; movers: Mover[]; positions: KrakenPosition[]; closes: KrakenClosedTrade[]; stats: Stats;
	scanStats: ScanStats; risk: RiskState; settings: KrakenSettings; pinned: string[]; balanceUsdMicros: string;
	solUsd: { price: string; at: number } | null }
export type KrakenCommand =
	| { type: "kraken_buy"; id: string; pair: string; holdConfirmed?: boolean }
	| { type: "kraken_sell"; id: string; pair: string; pct: 50 | 100 }
	| { type: "kraken_pin" | "kraken_unpin"; id: string; pair: string }
	| { type: "kraken_pause" | "kraken_resume"; id: string }
	| { type: "kraken_setSettings"; id: string; patch: unknown };
// engine/kraken/money.ts
export const USD_MICROS = 1_000_000n;
export function decimalText(value: number | string): string;          // no exponent notation; throws on NaN/Infinity
export function toScaled(value: number | string, decimals: number): bigint; // truncates digits past `decimals`
export function quoteBuy(budgetUsdMicros: bigint, ask: bigint, pair: KrakenPair, paper: KrakenSettings["paper"]):
	{ ok: true; lots: bigint; notionalUsdMicros: bigint; feesUsdMicros: bigint } | { ok: false; error: string };
export function quoteSell(lots: bigint, bid: bigint, pair: KrakenPair, paper: KrakenSettings["paper"]):
	{ ok: true; proceedsUsdMicros: bigint; feesUsdMicros: bigint } | { ok: false; error: string };
// settingsStore.ts: generic over the settings type
export class SettingsStore<T> { constructor(filePath: string, defaults: T, apply: (current: T, patch: unknown) =>
	{ ok: true; settings: T } | { ok: false; error: string }); get(): T; update(patch: unknown): ... }
```

- **Money math.** `p = priceDecimals`, `l = lotDecimals`, `bps = paper.extraSlippageBps`, and
  `feeBps = round(takerFeePct × 100)`.
  - Buy price `askEff = ask × (10_000 + bps) / 10_000`.
  - `lots = floor(budget × 10^(p+l) × 10_000 / (ask × (10_000 + bps) × 1_000_000))`.
  - `notional = ceil(lots × ask × (10_000 + bps) × 1_000_000 / (10^(p+l) × 10_000))`.
  - `fees = ceil(notional × feeBps / 10_000)`.
  - Sell: `proceeds = floor(lots × bid × (10_000 − bps) × 1_000_000 / (10^(p+l) × 10_000)) − fees`, with fees taken on
    the gross amount, rounded up.
  - Minimums: below `ordermin` gives `Below Kraken minimum order`; below `costmin` gives `Below Kraken minimum cost`;
    `lots == 0` gives `Buy size below one lot`.
- **Pump.fun settings store.** Built as
  `new SettingsStore(path, applySettingsPatch(DEFAULT_SETTINGS, modeDefaultsFor(mode)), applySettingsPatch)`, with the
  same error messages as today.

- [ ] **Step 1: Write failing tests**:
  - `decimalText(1.234e-8)` is `"0.00000001234"`.
  - `toScaled("0.00000001234", 10)` is `123n`.
  - `toScaled("12.5", 2)` is `1250n`.
  - A $50 buy (`50_000_000n` micro-USD) of a pair with `ask` = 1234 (p = 8, i.e. $0.00001234) and `l = 0`, at 15 bps
    and 0.80%: lots `4_045_795n`, notional `49_999_998n`, fees `400_000n`.
  - A sell of those lots at bid 1300: gross `52_516_441n`, fees `420_132n`, proceeds `52_096_309n`.
  - Settings:
    - A patch `{ buyUsd: 5000 }` clamps to 1000.
    - `{ rule: { minChange15mPct: -1 } }` is rejected.
    - An unknown key is rejected.
    - The defaults equal spec Section 12.
- [ ] **Step 2: Run** `npx vitest run test/kraken-money.test.ts test/kraken-settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with bigint arithmetic only. `decimalText` expands exponent notation by string
  manipulation, not `toFixed`.
- [ ] **Step 4: Run** both files and `test/settingsStore.test.ts`, then `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken types, settings and money math`.

### Task 3: Kraken REST client and pair universe

**Files:**
- Create: `src/engine/kraken/rest.ts`, `src/engine/kraken/pairs.ts`
- Test: `test/kraken-rest.test.ts`, `test/kraken-pairs.test.ts`

**Interfaces:**
- Consumes: `Clock`, `backoffDelay` (Milestone 1), `KrakenPair`, `KrakenSettings`.
- Produces:

```ts
export type HttpGet = (url: string) => Promise<{ status: number; body: string }>;
export class KrakenRestError extends Error {}
export interface KrakenRestLike { assetPairs(): Promise<unknown>; ticker(pairs: readonly string[]): Promise<unknown>;
	ohlc(pair: string): Promise<unknown> }
export class KrakenRest implements KrakenRestLike {
	constructor(deps: { get: HttpGet; clock: Clock; baseUrl?: string; jitterUnit?: () => number });
}
export function parseAssetPairs(result: unknown, excludeBases: readonly string[]): { pairs: KrakenPair[]; skipped: number };
export class PairUniverse {
	constructor(deps: { rest: KrakenRestLike; clock: Clock; settings: () => KrakenSettings });
	refresh(): Promise<void>;          // fetch + apply; throws KrakenRestError after retries
	apply(result: unknown): void;      // also used by replay
	all(): readonly KrakenPair[];
	byWsName(wsname: string): KrakenPair | undefined;
	byPair(pair: string): KrakenPair | undefined;
	onChange(listener: (added: string[], removed: string[]) => void): () => void;
	startHourlyRefresh(): () => void;
}
```

- **Requests.**
  - `GET /0/public/AssetPairs`.
  - `GET /0/public/Ticker?pair=<comma list>`, at most 100 pairs per call.
  - `GET /0/public/OHLC?pair=<pair>&interval=1`.
- **Rate limit.** Calls are spaced at least 1000 ms apart on the clock. HTTP 429 retries after
  `backoffDelay(attempt, jitter)`, at most 4 attempts.
- **Errors.** A non-empty `error` array in the JSON envelope throws `KrakenRestError` with the joined messages.
- **`parseAssetPairs`.**
  - Keeps entries whose `wsname` ends with `/USD`, or whose `quote` is `ZUSD`/`USD`.
  - Drops entries whose `status` is present and not `online`.
  - Drops entries whose display base is in `excludeBases`. The display base is the `wsname` left part, or `altname`
    without its `USD` suffix.
  - Missing `ordermin`, `costmin`, or `wsname` are tolerated. Malformed entries count as `skipped`.
- **`refresh()`** reports pairs that disappeared through `onChange` (the desk marks held ones HALTED).

- [ ] **Step 1: Write failing tests** with a fake `HttpGet` and `ManualClock`:
  - Two calls in a row are 1000 ms apart.
  - A 429 then 200 succeeds after one backoff.
  - Four 429s throw `KrakenRestError`.
  - An `{"error":["EGeneral:Too many requests"]}` body throws with that text.
  - `parseAssetPairs` over a fixture with a USD pair, a EUR pair, a `cancel_only` pair, a USDT/USD pair, and an
    entry without `wsname` keeps exactly the two tradeable non-stable USD pairs.
  - `refresh()` reports a removed pair to `onChange`.
- [ ] **Step 2: Run** `npx vitest run test/kraken-rest.test.ts test/kraken-pairs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Production `HttpGet` wraps the global `fetch` and reads `response.text()`.
- [ ] **Step 4: Run** both. Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken REST client and pair universe`.

### Task 4: Kraken WebSocket feed

**Files:**
- Create: `src/engine/kraken/feed.ts`
- Test: `test/kraken-feed.test.ts`

**Interfaces:**
- Consumes: `Clock`, `backoffDelay`, `FeedStatus`, `decimalText` (Task 2).
- Produces:

```ts
export type KrakenFeedEvent =
	| { type: "ticker"; wsname: string; bid: string; ask: string; last: string; volume24h: string; vwap24h: string | null;
		at: number }
	| { type: "bar"; wsname: string; begin: number; close: string; volume: string; at: number }
	| { type: "status"; status: FeedStatus; dropped: number; reconnectAt: number | null };
export interface KrakenFeedLike { setSymbols(wsnames: readonly string[]): void; start(): void; stop(): void;
	on(listener: (event: KrakenFeedEvent) => void): () => void; onRaw?(listener: (raw: string) => void): () => void }
export function parseKrakenMessage(raw: string, now: number):
	{ kind: "events"; events: KrakenFeedEvent[] } | { kind: "ignored" } | { kind: "invalid" };
export class KrakenFeed implements KrakenFeedLike {
	constructor(opts: { url: string; clock: Clock; captureFile: string | null; captureLimit: number; baseDelayMs?: number;
		jitterUnit?: () => number });
}
```

- **Subscriptions.** `setSymbols` diffs against the current set. It sends
  `{"method":"subscribe","params":{"channel":"ticker","symbol":[…≤50]}}` and the same with
  `"channel":"ohlc","interval":1`, plus `unsubscribe` for removed symbols. Everything is resubscribed after a reconnect.
- **Parser.**
  - Reads `channel` `ticker` (fields `symbol`, `bid`, `ask`, `last`, `volume`, `vwap`) and `ohlc` (fields `symbol`,
    `close`, `volume`, `interval_begin`) from `data[]`.
  - Accepts numbers or strings, converted with `decimalText`. `interval_begin` is an ISO string or epoch ms.
  - `heartbeat`, `status`, and subscribe acks are `ignored`.
  - Anything else is `invalid`, which counts as dropped.
- **Reconnect.** Backs off from 1 s to 30 s, with `reconnectAt` on the status event. The first `captureLimit` raw
  messages go to `captureFile`.

- [ ] **Step 1: Write failing tests** against a local `WebSocketServer` (the pattern in `test/feed-client.test.ts`):
  - `setSymbols` of 120 symbols sends three ticker and three ohlc subscribe messages.
  - A ticker message with numeric `bid: 1.234e-8` yields `bid: "0.00000001234"`.
  - An ohlc message yields a `bar` event with `begin` in epoch ms.
  - An unknown shape increments `dropped`.
  - After the server closes the socket, the client reconnects and resubscribes every symbol.
- [ ] **Step 2: Run** `npx vitest run test/kraken-feed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken WebSocket feed`.

### Task 5: Bars, momentum rule, scanner

**Files:**
- Create: `src/engine/kraken/bars.ts`, `src/engine/kraken/rule.ts`, `src/engine/kraken/scanner.ts`
- Test: `test/kraken-rule.test.ts`, `test/kraken-scanner.test.ts`

**Interfaces:**
- Consumes: `KrakenFeedEvent`, `PairUniverse`, `KrakenSettings`, `Mover`, `RuleStatus`, `toScaled`.
- Produces:

```ts
export interface Bar { begin: number; close: number; volume: number }        // close in USD, volume in base units
export class BarBook {
	constructor(maxBars?: number);                                            // default 60
	seed(wsname: string, bars: readonly Bar[]): void;
	update(bar: Bar & { wsname: string }): void;                              // same begin replaces
	change(wsname: string, minutes: number, now: number): number | null;      // % vs latest bar at or before now - minutes
	usdVolume(wsname: string, minutes: number, now: number): number;          // sum(volume × close) over bars in window
	minutesCovered(wsname: string, now: number): number;
}
export interface RuleInput { change5m: number | null; change15m: number | null; volumeUsd24h: number; spreadPct: number;
	usdVolume15m: number; usdVolume60m: number; minutesCovered: number; held: boolean; cooldownUntil: number | null;
	now: number }
export function evaluateRule(input: RuleInput, s: KrakenSettings): { status: RuleStatus; reason: string };
export class Scanner {
	constructor(deps: { universe: PairUniverse; bars: BarBook; clock: Clock; settings: () => KrakenSettings;
		held: (pair: string) => boolean; cooldownUntil: (pair: string) => number | null });
	onTicker(event: Extract<KrakenFeedEvent, { type: "ticker" }>): void;
	quote(pair: string): { bid: string; ask: string; last: string; at: number } | null;
	scan(): Mover[];                       // filters, rule status, top 50 by change15m desc (nulls last)
	needsSeed(): string[];                 // wsnames that pass the volume filter and have never been seeded
}
```

- **`evaluateRule`** checks in this order, and the first failure wins:

  | Status | Reason copy |
  |---|---|
  | `warming_up` | `Warming up (<n> of 15 min)` |
  | `low_volume` | `Volume $<k>k < $250k` |
  | `wide_spread` | `Spread <x>% > 0.6%` |
  | `small_move` | `Up <x>% in 15m (needs 4%)` |
  | `not_rising` | `Falling over 5m` |
  | `no_volume_surge` | `Volume <x>x hourly pace (needs 2x)` |
  | `held` | `Already held` |
  | `cooldown` | `Cooldown until HH:MM` |
  | `eligible` | `All rule checks passed` |

  The thresholds in the copy come from settings; the table shows the defaults. The volume surge test is
  `usdVolume15m ≥ volumeSurge × usdVolume60m / 4`.
- **24h USD volume** is `volume24h × (vwap24h ?? last)`. Spread is `(ask − bid) / ((ask + bid) / 2) × 100`.

- [ ] **Step 1: Write failing tests**, each condition at its boundary:
  - 15m change of exactly 4.0 passes and 3.99 fails.
  - Spread 0.6 passes and 0.61 fails.
  - Surge of exactly 2x passes.
  - 14 minutes covered gives `warming_up`.
  - `change` returns null without an old enough bar.
  - `scan()` excludes a pair under $250k, sorts by 15m change, and caps at 50.
  - `needsSeed()` lists only pairs that pass the volume filter, once.
- [ ] **Step 2: Run** `npx vitest run test/kraken-rule.test.ts test/kraken-scanner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken bars, momentum rule and scanner`.

### Task 6: Kraken paper executor and ledger

**Files:**
- Create: `src/engine/ledger/jsonl.ts`, `src/engine/kraken/paper.ts`, `src/engine/kraken/ledger.ts`
- Modify: `src/engine/ledger/ledger.ts` (uses `jsonl.ts`; behaviour unchanged)
- Test: `test/kraken-paper.test.ts`, `test/kraken-ledger.test.ts`, existing `test/ledger.test.ts`

**Interfaces:**
- Consumes: `quoteBuy`, `quoteSell`, `toScaled`, `KrakenFill`, `KrakenClosedTrade`, `PairUniverse`, `Clock`.
- Produces:

```ts
// jsonl.ts
export class JsonlLog<T> {
	constructor(filePath: string, schema: z.ZodType<T>);
	load(): { records: T[]; warnings: string[] };  // "Skipped malformed ledger line <n>"
	append(record: T): void;                       // fresh line after a truncated tail
	reset(): void;
}
// kraken/paper.ts
export type KrakenFillResult = { ok: true; fill: KrakenFill } | { ok: false; error: string };
export class KrakenPaperExecutor {
	constructor(deps: { mode: Mode; clock: Clock; settings: () => KrakenSettings; universe: PairUniverse;
		quote: (pair: string) => { bid: string; ask: string; at: number } | null; halted: (pair: string) => boolean });
	buy(r: { positionId: string; pair: string; usdMicros: bigint }): Promise<KrakenFillResult>;
	sell(r: { positionId: string; pair: string; lots: bigint }): Promise<KrakenFillResult>;
}
// kraken/ledger.ts
export interface KrakenLot { positionId: string; mode: Mode; pair: string; symbol: string; openedAt: number;
	costUsdMicros: bigint; proceedsUsdMicros: bigint; lots: bigint }
export class KrakenLedger {
	constructor(filePath: string);
	load(): { open: KrakenLot[]; closed: KrakenClosedTrade[]; warnings: string[] };
	appendFill(fill: KrakenFill): void;
	appendClose(r: { positionId: string; mode: Mode; pnlUsdMicros: string; pnlPct: number; reason: ExitReason; ts: number }): void;
	reset(): void;
}
```

- **Paper fills.**
  - Each fill waits `paper.latencyMs`, then quotes at that moment's ask (buy) or bid (sell).
  - Cost recorded is `notional + fees`; proceeds recorded are net of fees.
  - Errors: `No price for <symbol>`, `Pair halted`, and the money-math errors from Task 2.
- **Ledger rebuild** mirrors Milestone 1: cost sums buys plus fees, proceeds sum sells minus fees, and a close turns a
  lot into a `KrakenClosedTrade`.

- [ ] **Step 1: Write failing tests**:
  - A buy waits 300 ms, then fills at the ask in effect after the wait.
  - A halted pair refuses with `Pair halted`.
  - With no quote, the buy fails with `No price for PEPE`.
  - Ledger round trip: buy, two half sells, close gives the right `pnlUsdMicros`.
  - A malformed middle line is skipped with its line number.
  - The existing `test/ledger.test.ts` still passes unchanged.
- [ ] **Step 2: Run** `npx vitest run test/kraken-paper.test.ts test/kraken-ledger.test.ts test/ledger.test.ts`.
  Expected: the new files FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken paper executor and ledger`.

### Task 7: Kraken positions and exits

**Files:**
- Create: `src/engine/kraken/positions.ts`
- Test: `test/kraken-positions.test.ts`

**Interfaces:**
- Consumes: `KrakenLot`, `KrakenPosition`, `KrakenSettings`, `quoteSell`.
- Produces:

```ts
export interface KrakenPositionState { id: string; mode: Mode; pair: string; symbol: string; openedAt: number;
	costUsdMicros: bigint; proceedsUsdMicros: bigint; lots: bigint; valueUsdMicros: bigint | null; pnlPct: number | null;
	peakPnlPct: number; price: string | null; priceAt: number | null; halted: boolean; pendingOrder: boolean }
export function krakenFromLot(lot: KrakenLot): KrakenPositionState;
export function krakenRevalue(p: KrakenPositionState, valueUsdMicros: bigint, price: string, at: number): KrakenPositionState;
export function krakenIsStale(p: KrakenPositionState, now: number, s: KrakenSettings): boolean;
export function evaluateKrakenExit(p: KrakenPositionState, now: number, s: KrakenSettings): ExitReason | null;
export function krakenToView(p: KrakenPositionState, now: number, s: KrakenSettings): KrakenPosition;
```

- `pnlPct` is computed in bigint to 4 decimals, as Milestone 1 does.
- `evaluateKrakenExit` returns `null` while halted, pending, or stale. Otherwise it checks, in order:
  1. `max_hold`;
  2. `stop_loss` (`pnlPct ≤ −stopLossPct`);
  3. `trailing` (`peak > trailingArmPct && pnlPct ≤ peak − trailingStopPct`);
  4. `take_profit` (`pnlPct ≥ takeProfitPct`).

- [ ] **Step 1: Write failing tests**:
  - TP fires at exactly +6 and not at +5.9999.
  - SL fires at exactly −3.
  - Trailing: with a peak of 2.0 it does not arm; with a peak of 2.5 it fires at 0.5 and not at 0.6.
  - Max hold fires at 120 min.
  - Halted, pending, and stale positions each block every exit.
- [ ] **Step 2: Run** `npx vitest run test/kraken-positions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken positions and exits`.

### Task 8: Kraken desk core

**Files:**
- Create: `src/engine/kraken/desk.ts`
- Test: `test/kraken-desk.test.ts`, plus `test/helpers/fakeKraken.ts` (fake `KrakenFeedLike` and `KrakenRestLike`)

**Interfaces:**
- Consumes: Tasks 1–7, `EngineBus`, `SettingsStore<KrakenSettings>`, `RiskGuard`.
- Produces:

```ts
export interface KrakenDeskDeps { mode: Mode; synthetic: boolean; feed: KrakenFeedLike; rest: KrakenRestLike;
	universe: PairUniverse; bars: BarBook; executor: KrakenPaperExecutor; ledger: KrakenLedger;
	settings: SettingsStore<KrakenSettings>; risk: RiskGuard; clock: Clock; bus: EngineBus; tzOffsetMin: () => number }
export class KrakenDesk {
	constructor(deps: KrakenDeskDeps);
	start(): Promise<void>;         // load ledger, universe.refresh() + startHourlyRefresh(),
	                                // feed.setSymbols(all + "SOL/USD"), start loops
	stop(): Promise<void>;
	snapshot(): KrakenSnapshot;
	handleCommand(c: KrakenCommand): Promise<{ ok: true } | { ok: false; error: string }>;
	kill(): void;                   // sell all; pause; sell late fills until resume()
	resume(): void;
}
```

- **Loops** (engine clock):
  - Scan every 5 000 ms. It emits `kraken_movers`, auto-buys `eligible` pairs in rank order through
    `risk.canOpen("auto", …, { signal: "approved" })`, and counts each skip by reason into `scanStats`.
  - Exits are checked on every ticker for held pairs and on a 1 000 ms tick.
  - Candle seeding takes `scanner.needsSeed()` one pair at a time through `rest.ohlc`.
- **Guard.** Built with `RiskLimits` from Kraken settings, and copy `{ autoOff: "Auto-buy off", notApproved:
  "Not eligible", rejectedHold: "Hold to buy a pair the rule skipped" }`.
- **Manual buys** use signal `"approved"` for `eligible` and `"rejected"` for any other status.
- **Universe changes.** A removed held pair becomes `halted: true` and emits a `Kraken: <SYM> halted` warning log. A
  pair that reappears un-halts.
- **SOL/USD.** The ticker for `SOL/USD` updates `solUsd`, throttled to one `kraken_sol_usd` event per 5 s.
- **Price events** go out for held and pinned pairs only, at most 4 per second per pair.
- **Balance.** `balanceUsdMicros = startingBalanceUsd + realized − open cost − pending buys`. A buy whose
  `notional + fees` exceeds it fails with `Insufficient paper balance`.
- **Commands.**
  - A pair outside the current universe is refused with `Unknown pair`.
  - Pins cap at 6 with `Hotbar full (6 pins)`.
  - `kraken_setSettings` goes through `SettingsStore<KrakenSettings>`. AUTO toggles `autoBuy`.
- **Movers per hour** counts the distinct pairs whose 15-minute change met `minChange15mPct`, in each of the last 24
  hours.
- **Logs** go on the shared `log` event, prefixed `Kraken:`.

- [ ] **Step 1: Write failing tests** on `ManualClock` with fakes:
  - A seeded mover that meets the rule is bought within one scan and exits `take_profit` when the bid rises 7%.
  - A pair with a 0.9% spread is never bought, and `scanStats.skipReasons` counts `wide_spread`.
  - Held pair removed from the universe: `halted: true`, no exit at −10%, and manual sell returns `Pair halted`.
  - Rest client throws 429 errors on `ohlc`: the desk keeps scanning, and a pair with 15 live minutes still becomes
    eligible.
  - Tilt after 3 losses blocks auto-buys for 30 min.
  - Restart rebuilds an open lot from the ledger.
  - Re-entry is refused for 60 min after an exit.
  - A buy beyond the balance fails with `Insufficient paper balance`.
  - A seventh pin returns `Hotbar full (6 pins)`.
  - `kraken_buy` for a pair outside the universe returns `Unknown pair`.
- [ ] **Step 2: Run** `npx vitest run test/kraken-desk.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken desk core`.

### Task 9: Protocol, Engine composition, bridge, entrypoint

**Files:**
- Create: `src/engine/core/engine.ts`
- Modify: `src/shared/protocol.ts`, `src/engine/core/tradingCore.ts`, `src/engine/bridge/server.ts`,
  `src/engine/main.ts`, `src/engine/env.ts`, `.env.example`
- Test: `test/engine.test.ts`, `test/protocol.test.ts`, `test/bridge.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `TradingCore`, `KrakenDesk`.
- Produces:

```ts
// protocol.ts: zod schemas that `satisfies z.ZodType<...>` the Task 2 types (KrakenSnapshot with movers ≤ 50 and
// closes ≤ 500, KrakenCommand). EngineSnapshot gains `kraken: KrakenSnapshot | null`. CommandSchema adds KrakenCommand.
events: kraken_movers {movers} | kraken_price {pair, bid, ask, last, at} | kraken_order {order: KrakenOrderUpdate}
	| kraken_position {position} | kraken_close {trade} | kraken_stats {stats, scanStats} | kraken_feed {status, dropped,
	reconnectAt} | kraken_risk {risk} | kraken_balance {usdMicros} | kraken_settings {settings} | kraken_pinned {pairs}
	| kraken_sol_usd {price, at} | kraken_offline {error}
// engine.ts
export class Engine {
	constructor(pump: TradingCore, kraken: KrakenDesk | null, deps: { bus: EngineBus });
	start(): Promise<void>;       // pump first; a kraken start failure sets kraken error and emits kraken_offline
	stop(): Promise<void>;
	snapshot(): EngineSnapshot;
	handleCommand(c: Command): Promise<Ack>;  // kraken_* to the desk ("Kraken desk is off" when null); kill and resume
	                                          // reach both desks
}
// env.ts: EnvConfig gains `kraken: boolean` (KRAKEN=off → false; anything else or unset → true)
```

- `TradingCore.snapshot()` returns `Omit<EngineSnapshot, "kraken">`, and `Engine` adds the Kraken section.
- The bridge's `core` option becomes `Pick<Engine, "snapshot" | "handleCommand">`.
- `main.ts` builds the Kraken pieces when `env.kraken` is set and the mode is paper:
  - files `data/ledger-kraken-<mode>.jsonl`, `data/settings-kraken-<mode>.json`, and
    `data/fixtures/kraken-raw-<stamp>.jsonl`;
  - the production `KrakenRest`, `KrakenFeed`, and paper executor.
  - Demo and replay go through Task 10's sources.

- [ ] **Step 1: Write failing tests**:
  - **Engine startup:** with a Kraken desk whose `start()` rejects with `fetch failed`, `Engine.start()` resolves, the
    pump.fun snapshot is intact, and `snapshot().kraken.error` is `fetch failed`.
  - **Kill across desks:** open positions and an in-flight buy on each desk, then `kill`. After the fills, every
    position on both desks closes with reason `kill`, and both risk states read paused. `resume` unpauses both.
  - **Routing:** `kraken_buy` with the desk off returns `Kraken desk is off`.
  - **Protocol:** round-trips a snapshot with a Kraken section, and rejects `kraken_sell` with pct 30.
  - **Bridge:** delivers a `kraken_close` event to every client.
  - **Env:** `readEnv({ KRAKEN: "off" }).kraken` is false.
- [ ] **Step 2: Run** `npx vitest run test/engine.test.ts test/protocol.test.ts test/bridge.test.ts test/cli.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then `npx vitest run` (full) and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): compose pump.fun and Kraken desks behind one engine`.

### Task 10: Kraken recording, replay, and synthetic demo

**Files:**
- Create: `src/engine/kraken/replay.ts`, `src/engine/kraken/synthetic.ts`, `fixtures/kraken-demo-session.jsonl`
- Modify: `src/engine/replay/recording.ts`, `src/engine/replay/recorder.ts`, `src/engine/main.ts`,
  `scripts/make-demo.ts`
- Test: `test/kraken-replay.test.ts`, `test/demo.test.ts`

**Interfaces:**
- Consumes: `KrakenFeedLike`, `KrakenRestLike`, `parseKrakenMessage`, `PairUniverse.apply`, `mulberry32`.
- Produces:

```ts
// recording.ts adds
| { t: number; kind: "kraken_ws"; raw: string }
| { t: number; kind: "kraken_rest"; endpoint: "AssetPairs" | "Ticker" | "OHLC"; query: string; body: unknown }
| { t: number; kind: "kraken_feed"; status: FeedStatus }
// replay.ts
export class ReplayKrakenSource implements KrakenFeedLike, KrakenRestLike {
	constructor(lines: readonly RecordingLine[], clock: Clock, universe: () => PairUniverse | null);
	// rest calls return the latest recorded body for endpoint+query at or before now, else throw KrakenRestError
	// "Not in recording"; an AssetPairs line dispatched after start is applied to the universe
}
// synthetic.ts
export function buildKrakenDemo(seed: number): RecordingLine[];
```

- **Synthetic session**, labelled `SYNTHETIC DEMO`, with t in ms up to 200 000:
  - AssetPairs at t = 0, with 60 minutes of OHLC history for each pair so the rule can fire.
  - `MOONCAT/USD` passes the rule at about 20 s and takes profit.
  - `RUGDOG/USD` passes at about 50 s and stops out.
  - `WIDEBOI/USD` moves +9% with a 1.2% spread and is never bought.
  - `HALTY/USD` passes at about 80 s and is removed by an AssetPairs line at 120 s, so the held position halts.
  - A Kraken feed `down` at 100 s and `live` at 108 s.
  - `SOL/USD` ticks throughout at about $150. The price is synthetic: it's a demo fixture, not a quote.
- **`Recorder`** records Kraken REST responses and raw WebSocket messages when `--record` runs with the desk on.
- **`make-demo.ts`** writes both fixtures deterministically.

- [ ] **Step 1: Write failing tests**:
  - `buildKrakenDemo(7)` is deterministic and starts with the SYNTHETIC meta line.
  - The demo played through the real `KrakenDesk` closes `MOONCAT:take_profit` then `RUGDOG:stop_loss`, never orders
    `WIDEBOI`, and halts `HALTY`.
  - The scripted outcomes match at speed 1 and speed 4 (ScaledClock).
  - `ReplayKrakenSource` throws `Not in recording` for an unrecorded OHLC query.
- [ ] **Step 2: Run** `npx vitest run test/kraken-replay.test.ts test/demo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `npm run make-demo`.
- [ ] **Step 4: Run.** Expected: PASS, and `git diff --stat fixtures/demo-session.jsonl` is empty. Then
  `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken replay and synthetic demo session`.

### Task 11: Web store, desk switch, Kraken HUD

**Files:**
- Create: `src/web/hud/DeskSwitch.tsx`, `src/web/hud/KrakenRadar.tsx`, `src/web/hud/KrakenDesk.tsx`
- Modify: `src/web/state/store.ts`, `src/web/state/useGame.ts`, `src/web/App.tsx`, `src/web/hud/TopBar.tsx`,
  `src/web/hud/Hotbar.tsx`, `src/web/hud/SettingsPanel.tsx`, `src/web/hud/keybindings.ts`, `src/web/hud/actions.ts`,
  `src/web/styles.css`
- Test: `test/store.test.ts`, `test/keybindings.test.ts`

**Interfaces:**
- Consumes: Task 9 events and snapshot.
- Produces:

```ts
// store.ts
export type DeskId = "pump" | "kraken";
GameState gains: desk: DeskId; kraken: { combo: number; tier: TierId; trophies: KrakenTrophyId[];
	prices: Record<string, { bid: string; ask: string; last: string; at: number }>; orders: Record<string, OrderUpdate> }
export function screenTier(state: GameState): TierId;   // tier of the selected desk
export function krakenSessionUsdMicros(state: GameState): bigint;
// GameStore gains selectDesk(desk: DeskId): void
// keybindings.ts: ActionId gains "switchDesk", DEFAULT_KEYBINDINGS.switchDesk = "d", ACTION_LABELS "Switch desk"
// actions.ts
export function krakenHoldRequired(snapshot: EngineSnapshot | null, pair: string, now: number): boolean;
	// tilt active, or the pair's mover status is not "eligible", or the pair is not on the radar
```

- **Desk choice.** Remembered in `localStorage` key `super-c-sniper.desk`. `html[data-tier]` follows `screenTier`.
- **Top bar.** Shows the selected desk's balance (SOL or USD), session PnL, W/L, combo, tilt, feed, and engine chips,
  plus a `KRAKEN` badge when the Kraken desk is selected.
- **KRAKEN radar rows.**
  - Columns: pair symbol; 5, 15, and 60-minute change; 24h volume as `$1.2M`; spread.
  - The status chip uses the rule status text. `WARMING UP` is shown for `warming_up`.
  - Buttons: BUY (a `HoldButton` when `krakenHoldRequired`) and PIN.
- **Kraken desk panel** shows positions with `STALE` / `HALTED` tags and SELL 50% / 100%.
- **Settings panel** shows the Kraken settings sections while the Kraken desk is selected, with every key in spec
  Section 12.
- **Offline.** When `kraken.error` is set, the Kraken views show `KRAKEN OFFLINE: <error>`.
- **Dropped messages.** A `kraken_feed` event whose `dropped` count reaches a new power of ten logs
  `Kraken: <n> messages dropped (raw samples in data/fixtures/)`, as the pump.fun feed does.

- [ ] **Step 1: Write failing tests**:
  - The reducer applies every `kraken_*` event.
  - Kraken dropped counts log at 1 and 10 only, across 25 events.
  - `screenTier` follows `desk`.
  - The Kraken combo counts only Kraken closes.
  - `krakenHoldRequired` is true for a `wide_spread` pair and during tilt, and false for an eligible pair.
  - The default bindings include `switchDesk: "d"`.
- [ ] **Step 2: Run** `npx vitest run test/store.test.ts test/keybindings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then `npm run check` and `npm run build:web`. Run `npm run demo -- --speed 4` and screenshot
  the KRAKEN desk at 1440×900 and 390×844 with the Milestone 1 Playwright script. Expected:
  - no console errors;
  - no sideways scroll;
  - movers visible within 10 s.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add desk switch and Kraken HUD`.

### Task 12: INKY, the Kraken station, trophies, and chime

**Files:**
- Modify: `src/web/scene/office.ts`, `src/web/scene/cast/defs.ts`, `src/web/scene/monitors.ts`,
  `src/web/scene/director.ts`, `src/web/scene/SceneView.tsx`, `src/web/audio/sfx.ts`, `src/shared/progression.ts`
- Test: `test/director.test.ts`, `test/progression.test.ts`, `test/voxel.test.ts`

**Interfaces:**
- Produces:

```ts
// office.ts: CastId adds "inky"; ScreenId adds "inky"; Office.setTrophies(ids: readonly KrakenTrophyId[]): void
// progression.ts
export const KRAKEN_TROPHIES = [{ id: "inky_bronze", atUsd: 50 }, { id: "inky_silver", atUsd: 250 },
	{ id: "inky_gold", atUsd: 1000 }] as const;
export type KrakenTrophyId = (typeof KRAKEN_TROPHIES)[number]["id"];
export function unlockedTrophies(outcomes: readonly Outcome[]): KrakenTrophyId[]; // peak cumulative micro-USD
// sfx.ts: SfxId adds "chime"
```

- **INKY** is a squid-alien voxel model in `CAST_DEFS`:
  - a dome head with two large eyes;
  - six short tentacle legs instead of two;
  - a headset prop;
  - palette indexes chosen from `BASE_PALETTE` and distinct from the other five cast members.
- **Station.** INKY's desk sits in the front row. The exact spot is chosen from screenshots so no cast tag overlaps at
  390 px. The `inky` monitor draws the top 5 movers as `SYM +x.x%` lines, plus a trophy shelf with up to three
  voxel cups.
- **Director:**
  - `kraken_order` filled: INKY `work`, then `celebrate`, and `chime`.
  - `kraken_close` win: INKY `celebrate` with a `+$x.xx` bubble, coins at INKY's anchor, and the combo banner when the
    Kraken desk is selected.
  - `kraken_close` loss: INKY `fail` and the `loss` sound.
  - `kraken_feed` down: INKY `sleep`.
  - `kraken_offline`: INKY `sleep` with an `OFFLINE` bubble.

- [ ] **Step 1: Write failing tests**:
  - `reactionsFor` returns the INKY reactions above for each event.
  - `unlockedTrophies` unlocks at exactly $50.00 peak and never removes a trophy after a later loss.
  - The INKY voxel parts are non-empty and use valid palette indexes.
- [ ] **Step 2: Run** `npx vitest run test/director.test.ts test/progression.test.ts test/voxel.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then `npm run check` and `npm run build:web`. Screenshot the demo at 1440×900 and 390×844.
  Expected: INKY is visible, tags don't overlap, and the trophy shelf appears after the MOONCAT win.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add INKY and the Kraken station`.

### Task 13: Analytics tabs

**Files:**
- Modify: `src/web/hud/Analytics.tsx`, `src/web/hud/charts.ts`, `src/web/styles.css`
- Test: `test/charts.test.ts`

**Interfaces:**
- Produces:

```ts
// charts.ts
export interface Series { label: string; color: string; points: { x: number; y: number }[] }
export function drawLines(ctx: CanvasRenderingContext2D, series: readonly Series[], box: Box, colors: ChartColors,
	format?: Format): Hit[];   // one shared y-axis, 2px lines, end dot + direct label per series
export function combinedRealizedUsd(pumpRealizedSol: number, solUsd: number | null, krakenRealizedUsd: number):
	{ totalUsd: number | null; note: string | null };  // null total + "No SOL/USD price; pump.fun shown in SOL" when no rate
```

- **Tabs.** `PUMP.FUN`, `KRAKEN`, `COMBINED` as a tablist in the terminal header.
- **KRAKEN tab.** The Milestone 1 layout with USD formatting (`+$12.34`). "Launches per hour" becomes
  `MOVERS PER HOUR` and "Top rejections" becomes `TOP SKIP REASONS`.
- **COMBINED tab:**
  - a total realized tile, with the SOL/USD rate and its time as the tile subtitle;
  - a two-series cumulative USD chart. The pump.fun series is converted at the current `solUsd`, and the subtitle
    says so.
  - Both verdict boxes side by side.
- **Series colours.** Validate the two colours with the dataviz validator against `#0d1122`
  (`node <dataviz>/scripts/validate_palette.js "<a>,<b>" --mode dark`) and use the passing pair. The gain and loss
  colours stay `#17a693` / `#de6838`.

- [ ] **Step 1: Write failing tests**:
  - `combinedRealizedUsd(0.5, 150, 12)` gives `{ totalUsd: 87, note: null }`.
  - `combinedRealizedUsd(0.5, null, 12)` gives a null total with the note.
  - `drawLines` returns one hit per point across both series, on a shared scale.
- [ ] **Step 2: Run** `npx vitest run test/charts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then `npm run check` and `npm run build:web`. Screenshot all three tabs in the demo at
  1440×900 and 390×844. Expected:
  - both series are labelled;
  - nothing overlaps;
  - the tooltip and arrow-key readouts work on the combined chart.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add Kraken and combined analytics tabs`.

### Task 14: End-to-end, README, acceptance

**Files:**
- Modify: `e2e/demo.spec.ts`, `README.md`, `.env.example`, `docs/implementation/2026-10-15-milestone-1-handoff.md`
  (pointer to this milestone)
- Test: `e2e/demo.spec.ts`

- [ ] **Step 1: Write the e2e tests**:
  - Pressing `d` switches the radar to Kraken movers and the balance chip to USD.
  - INKY's tag is present.
  - The analytics KRAKEN and COMBINED tabs show the verdict and a non-blank chart canvas.
  - `MOONCAT` appears in the Kraken closes table.
  - There's no sideways scroll at 390×844.
- [ ] **Step 2: Run** `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`. Expected: FAIL on the new
  tests only until the app satisfies them; fix the app, not the test.
- [ ] **Step 3: Update the README** with:
  - the Kraken desk: what it does;
  - `KRAKEN=on|off`;
  - every Kraken setting with its default;
  - the Kraken failure table rows with owner actions;
  - the data files;
  - the fee-tier instruction (set `paper.takerFeePct` from the account);
  - key-safety rules for the later live phase;
  - the unverified Kraken facts from spec Section 2.
- [ ] **Step 4: Acceptance pass**, all from `apps/solana-tycoon/`:
  - `npx vitest run` passes;
  - `npm run check` is clean;
  - the e2e suite passes;
  - `grep -rnE "TODO|FIXME|lorem|Math\.random" src scripts` returns nothing;
  - `grep -rniE "api[_-]?key|secret|KRAKEN_KEY" src` returns nothing;
  - view the screenshots.
- [ ] **Step 5: Commit**: `docs(solana-tycoon): document the Kraken desk and add its end-to-end tests`.
