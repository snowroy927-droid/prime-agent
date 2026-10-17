# SUPER C SNIPER Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the paper-mode engine and the full gamified dashboard so `npm install && npm start` runs a real-data
pump.fun command center on the owner's machine, and `npm run demo` runs the same experience offline.

**Architecture:** One Node 22 process (TypeScript via `tsx`) runs the engine: PumpPortal launch feed, chain reads through
the official pump.fun SDK, rug checks, a paper executor, positions, risk guard, an append-only ledger, and a loopback
HTTP + WebSocket bridge that serves the Vite-built web app. The web app is React for the HUD over a Three.js scene
rendered at 320x180 with palette quantization and a CRT pass. Pure game logic (combo, tilt, stats, progression,
protocol) lives in `src/shared/` and is used by both sides.

**Tech Stack:** Node 22, TypeScript 7.0.2, `@pump-fun/pump-sdk`, `@pump-fun/pump-swap-sdk` 1.20.0, `@solana/web3.js`
1.99.0, `ws` 8.22.0, zod 4.6.5, React 19.3.0, three 0.186.1, Vite 8.2.4, Vitest 5.0.3, Playwright 1.64.0, Biome 2.3.5.

**Spec:** `apps/solana-tycoon/docs/specs/2026-10-15-super-c-sniper-design.md`

## Global Constraints

- All app files live under `apps/solana-tycoon/`. Nothing outside it changes except this branch's commits.
- Dependencies pinned exactly (`npm install --save-exact`), each published at least 7 days before install. Local npm
  10.9.4 ignores `min-release-age`, so check dates with `npm view <pkg> time` before adding anything not listed here.
- `@pump-fun/pump-sdk`: 4.0.0 when installed at or after 2026-10-15 12:53 UTC, otherwise 3.2.0.
- Pinned versions: `@pump-fun/pump-swap-sdk` 1.20.0, `@solana/web3.js` 1.99.0, `bn.js` 5.2.5, `@types/bn.js` 5.2.0,
  `three` 0.186.1, `@types/three` 0.186.0, `react` / `react-dom` / `@types/react` / `@types/react-dom` 19.3.0, `vite`
  8.2.4, `@vitejs/plugin-react` 6.1.2, `zod` 4.6.5, `ws` 8.22.0, `@types/ws` 8.18.2, `vitest` 5.0.3,
  `@playwright/test` 1.64.0, `typescript` 7.0.2, `tsx` 4.23.15, `@biomejs/biome` 2.3.5, `@fontsource/press-start-2p`
  5.3.0, `@fontsource/vt323` 5.3.0. `@solana/spl-token`: newest 0.4.x at least 7 days old.
- Repo rules (`AGENTS.md`): no `any` unless unavoidable, no inline or dynamic imports, sparse comments, no emojis in
  code or commits, every keybinding configurable, `git add` only named files, never `git add -A`.
- Formatting mirrors the repo: tabs, indent width 3, line width 120 (app-local `biome.json`).
- Amounts are `bigint` lamports and raw token units inside the engine, decimal strings on the wire and in the ledger.
  Field names carry the unit (`solLamports`, `feesLamports`, `pnlLamports`); this replaces the spec's `solAmount` /
  `feesSol` / `pnlSol` names, which the spec defines as lamport strings.
- Fixed constants: `LAMPORTS_PER_SOL = 1_000_000_000n`, `BASE_FEE_LAMPORTS = 5_000n`,
  `TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n`, pump token decimals 6.
- Bridge binds `127.0.0.1` only. Default port 7777.
- No `Math.random` in `src/`. Ids use `crypto.randomUUID()`. The synthetic demo generator uses a seeded PRNG.
- HUD badge copy: `PAPER`, `LIVE`, `REPLAY`, `SYNTHETIC DEMO`.
- Run app commands from `apps/solana-tycoon/`. Single test file: `npx vitest run test/<file>.test.ts`. App check:
  `npm run check`. Never run the repo root's `npm run dev`, `npm run build`, or `npm test`.

Plan decisions that refine the spec (raised with the owner at handoff):

- Paper fills use the SDK's v2-family quote functions (`getBuyTokenAmountFromSolAmount`,
  `getSellSolAmountFromTokenAmount`) for every SOL curve. The SDK README states v3 prices and fees equal v2 within the
  remaining supply; a paper buy that would cross the remaining supply fails with `Buy exceeds remaining curve supply`.
- Watched curves get both an account subscription (latency) and one batched `getMultipleAccountsInfo` poll every 2s
  (freshness). Updates with a slot at or below the last seen slot are dropped. This replaces websocket-drop detection.
- Soft rug rules (`top_holder`, `holder_spread`, `min_real_sol`) are re-checked at +10s and +30s after launch
  (`recheckDelaysSec`). Without re-checks, the default thresholds reject nearly every coin at +2s.
- Paper balance starts at `paper.startingBalanceSol` (default 1.0). A buy beyond the free balance fails with
  `Insufficient paper balance`.
- Replay and demo ledgers are reset at engine start. Paper ledgers persist.
- `MODE=live` in Milestone 1 exits with `Live mode arrives in Milestone 2. Set MODE=paper.`
- No Vite dev server. The engine always serves the built app, so the token and Origin rules hold in development too.

## Review Focus

1. Engine restarts with open positions whose coins migrated or completed while it was down: positions resume on pool
   pricing or show STALE, startup never throws. Test in Task 14.
2. A burst of launches beyond the RPC budget: launches past the budget are `unchecked`, never auto-sniped, and the
   radar stays capped at 50. Test in Task 14.
3. Two browser tabs and double-clicked SNIPE: both tabs get every event, the second snipe for the same mint gets
   `Order already pending`, only one fill happens. Tests in Tasks 14 and 15.
4. Settings edits with invalid values (negative take profit, buy size 5 SOL, wrong types): invalid patches are rejected
   with the zod message and leave settings unchanged; buy size and max positions clamp to 1 SOL and 10. Tests in Tasks 2
   and 14.
5. A malformed line in the middle of a ledger (not only the last line): skipped with a warning naming the line number,
   every other record still loads. Test in Task 6.

---

## File map

```
apps/solana-tycoon/
  package.json  .npmrc  .gitignore  .env.example  biome.json  tsconfig.json  vite.config.ts  vitest.config.ts
  playwright.config.ts  index.html  README.md
  scripts/make-demo.ts                 writes fixtures/demo-session.jsonl
  fixtures/demo-session.jsonl          committed synthetic session
  src/shared/
    units.ts        lamport constants and conversions
    types.ts        domain types shared by engine and web
    settings.ts     zod settings schema, defaults, hard limits, patching
    combo.ts        combo count and palette tier
    tilt.ts         consecutive losses and tilt window
    progression.ts  office upgrades from peak realized PnL
    stats.ts        trade and launch statistics, experiment verdict
    protocol.ts     bridge events, commands, acks (zod)
  src/engine/
    main.ts  cli.ts  env.ts  clock.ts  bus.ts  codec.ts  settingsStore.ts
    feed/     types.ts parse.ts backoff.ts pumpportal.ts
    chain/    types.ts rpcBudget.ts pumpChain.ts pumpPool.ts
    scout/    launchHistory.ts rugcheck.ts scout.ts
    trader/   quote.ts paper.ts positions.ts executor.ts
    risk/     guard.ts
    ledger/   ledger.ts
    core/     tradingCore.ts
    bridge/   server.ts
    replay/   recording.ts recorder.ts player.ts synthetic.ts
  src/web/
    main.tsx  App.tsx  styles.css
    net/      bridgeClient.ts
    state/    store.ts useGame.ts
    hud/      TopBar.tsx Radar.tsx Positions.tsx Hotbar.tsx EventLog.tsx SettingsPanel.tsx Analytics.tsx
              charts.ts keybindings.ts Offline.tsx Banner.tsx
    scene/    palettes.ts shaders.ts renderer.ts voxel.ts office.ts monitors.ts effects.ts director.ts SceneView.tsx
    scene/cast/ defs.ts character.ts
    audio/    sfx.ts
  test/       one file per module, plus helpers/ (fake connection, fake chain, fake feed, curve fixtures)
  e2e/        demo.spec.ts
```

---

### Task 1: Package scaffold and toolchain

**Files:**
- Create: `apps/solana-tycoon/package.json`, `.npmrc`, `.gitignore`, `.env.example`, `biome.json`, `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/web/main.tsx` (renders an empty `<div id="app">` mount)
- Test: `apps/solana-tycoon/test/toolchain.test.ts`

**Interfaces:**
- Produces: scripts `build:web` (`vite build`, out `dist/web`), `start` (`npm run build:web && tsx src/engine/main.ts`),
  `demo` (`npm run build:web && tsx src/engine/main.ts --demo`), `replay` (`npm run build:web && tsx
  src/engine/main.ts --replay`), `make-demo` (`tsx scripts/make-demo.ts`), `check` (`biome check --write
  --error-on-warnings . && tsc --noEmit`), `test:e2e` (`playwright test`). `"type": "module"`, `"private": true`,
  `"engines": { "node": ">=22.12" }`.
- `.gitignore`: `node_modules/`, `dist/`, `data/`, `.env`, `test-results/`, `playwright-report/`, `*.keypair.json`.
- `.npmrc`: `min-release-age=7`.
- `.env.example`: every key from spec Section 6 with its default and a one-line comment.
- `tsconfig.json`: `strict`, `noEmit`, `module`/`moduleResolution` `bundler`, `target` `ES2023`, `lib` `ES2023`, `DOM`,
  `DOM.Iterable`, `jsx` `react-jsx`, `types` `node`, includes `src`, `test`, `scripts`, `e2e`.

- [ ] **Step 1: Write the failing test** `test/toolchain.test.ts`: `it("exposes the pump SDK functions the engine uses")`
  asserts `typeof` is `"function"` for `bondingCurvePda`, `getBuyTokenAmountFromSolAmount`,
  `getSellSolAmountFromTokenAmount`, `bondingCurveMarketCap`, `isBondingCurveMigrated`, `newBondingCurve`, and that
  `PUMP_SDK.decodeBondingCurve` and `OnlinePumpSdk` exist; and `sellBaseInput`, `canonicalPumpPoolPda`, `PUMP_AMM_SDK`
  exist in `@pump-fun/pump-swap-sdk`.
- [ ] **Step 2: Run it to verify it fails**: `npx vitest run test/toolchain.test.ts`. Expected: FAIL, packages missing.
- [ ] **Step 3: Write the config files and install the pinned dependencies** with `npm install --save-exact`. Check
  `npm ls --all` for any transitive or peer package newer than 7 days; pin an older compatible version through
  `overrides` if one appears.
- [ ] **Step 4: Run the test and the app check**: `npx vitest run test/toolchain.test.ts` PASS; `npm run check` exits 0;
  `npm run build:web` produces `dist/web/index.html`.
- [ ] **Step 5: Commit** `package.json package-lock.json .npmrc .gitignore .env.example biome.json tsconfig.json
  vite.config.ts vitest.config.ts index.html src/web/main.tsx test/toolchain.test.ts` with message
  `feat(solana-tycoon): scaffold app package and toolchain`.

### Task 2: Units, domain types, settings

**Files:**
- Create: `src/shared/units.ts`, `src/shared/types.ts`, `src/shared/settings.ts`
- Test: `test/units.test.ts`, `test/settings.test.ts`

**Interfaces:**
- Produces `units.ts`: `LAMPORTS_PER_SOL`, `BASE_FEE_LAMPORTS`, `TOKEN_ACCOUNT_RENT_LAMPORTS`, `TOKEN_DECIMALS = 6`,
  `solToLamports(sol: number): bigint` (rounds to nearest lamport), `lamportsToSol(l: bigint | string): number`,
  `formatSol(l: bigint | string, digits?: number): string` (default 4, sign shown for nonzero: `+0.0500`),
  `pnlPct(cost: bigint, returned: bigint): number`, `haircut(amount: bigint, bps: number): bigint`
  (`amount * (10000 - bps) / 10000`, floor).
- Produces `types.ts` exactly:

```ts
export type Mode = "paper" | "live" | "replay" | "demo";
export type FeedStatus = "connecting" | "live" | "down";
export interface Launch { mint: string; name: string; symbol: string; creator: string | null; signature: string | null;
	uri: string | null; marketCapSol: number | null; receivedAt: number }
export type RuleId = "quote_sol" | "not_mayhem" | "curve_live" | "blocklist" | "serial_launcher" | "top_holder"
	| "holder_spread" | "min_real_sol";
export interface RuleResult { rule: RuleId; pass: boolean; reason: string }
export type Verdict = "pending" | "approved" | "rejected" | "unchecked";
export interface CheckResult { mint: string; verdict: Verdict; results: RuleResult[]; reason: string; checkedAt: number;
	attempt: number }
export interface PriceTick { mint: string; priceSol: number; marketCapSol: number; source: "curve" | "pool"; at: number }
export type Side = "buy" | "sell";
export interface Fill { id: string; positionId: string; mode: Mode; mint: string; symbol: string; side: Side;
	solLamports: string; tokenAmount: string; feesLamports: string; signature?: string; ts: number }
export type ExitReason = "take_profit" | "stop_loss" | "trailing" | "manual" | "kill" | "max_hold";
export interface ClosedTrade { positionId: string; mode: Mode; mint: string; symbol: string; costLamports: string;
	proceedsLamports: string; pnlLamports: string; pnlPct: number; reason: ExitReason; openedAt: number; closedAt: number }
export interface Position { id: string; mode: Mode; mint: string; symbol: string; openedAt: number; costLamports: string;
	tokenAmount: string; proceedsLamports: string; valueLamports: string | null; pnlPct: number | null;
	peakPnlPct: number; priceSol: number | null; priceAt: number | null; stale: boolean; migrated: boolean;
	pendingOrder: boolean }
export type OrderStatus = "pending" | "filled" | "failed";
export interface OrderUpdate { id: string; positionId: string; mint: string; symbol: string; side: Side;
	status: OrderStatus; source: "auto" | "manual" | "exit"; error?: string; at: number }
export interface RiskState { autoSnipe: boolean; paused: boolean; pausedReason: string | null; tiltLosses: number;
	tiltUntil: number | null; dailyPnlLamports: string; dailyCapUntil: number | null }
export interface LogLine { level: "info" | "warn" | "error"; message: string; at: number }
```

- Produces `settings.ts`: `SettingsSchema` (zod), `type Settings`, `DEFAULT_SETTINGS`, `HARD_LIMITS = { buySolMax: 1,
  maxPositionsMax: 10 }`, `applySettingsPatch(current: Settings, patch: unknown): { ok: true; settings: Settings } | {
  ok: false; error: string }` (deep-merges, validates, then clamps `buySol` and `maxPositions`).
- Defaults (spec 4.3, 4.4, 4.5, 4.6 plus plan decisions): `buySol 0.05`, `maxPositions 3`, `takeProfitPct 100`,
  `stopLossPct 30`, `trailingStopPct 0`, `maxHoldMin 30`, `dailyLossCapSol 0.15`, `tiltLosses 3`, `tiltCooldownMin 10`,
  `autoSnipe true`, `snipeDelaySec 2`, `recheckDelaysSec [10, 30]`, `priceStaleSec 10`, `rug: { blocklist: ["test",
  "rug", "scam", "fake", "honeypot"], serialLaunchMax 3, serialWindowMin 60, maxTopHolderPct 20, minHoldersInTop20 10,
  minRealSol 1.0 }`, `paper: { startingBalanceSol 1.0, latencyMs 800, extraSlippageBps 300, priorityFeeSol 0.0005 }`.
- Validation: positive numbers where a zero is meaningless, `stopLossPct` at most 100, `maxTopHolderPct` 0-100,
  `minHoldersInTop20` integer 0-20, `extraSlippageBps` integer 0-5000, integer `maxPositions` and `tiltLosses`.

- [ ] **Step 1: Write failing tests**:
  - `units.test.ts`: `solToLamports(0.05) === 50_000_000n`; `formatSol(50_000_000n) === "+0.0500"`;
    `haircut(1_000_000n, 300) === 970_000n`; `pnlPct(100n, 250n) === 150`.
  - `settings.test.ts`, "defaults match the spec": `DEFAULT_SETTINGS.buySol === 0.05`,
    `rug.minRealSol === 1`, `paper.latencyMs === 800`.
  - `settings.test.ts`, "clamps hard limits": a patch `{ buySol: 5, maxPositions: 40 }` gives `1` and `10`.
  - `settings.test.ts`, "rejects invalid patch and keeps current":
    - `{ takeProfitPct: -5 }` returns `ok: false`, and the error mentions `takeProfitPct`;
    - `{ rug: { minHoldersInTop20: "ten" } }` returns `ok: false`;
    - `{ paper: { latencyMs: 400 } }` merges and keeps the other `paper` fields.
- [ ] **Step 2: Run** `npx vitest run test/units.test.ts test/settings.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the three modules** with the signatures above.
- [ ] **Step 4: Run the tests again.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add shared units, domain types, and settings schema`.

### Task 3: Combo, tilt, progression

**Files:**
- Create: `src/shared/combo.ts`, `src/shared/tilt.ts`, `src/shared/progression.ts`
- Test: `test/combo.test.ts`, `test/tilt.test.ts`, `test/progression.test.ts`

**Interfaces:**
- Consumes: `ClosedTrade`, `Settings` (Task 2).
- Produces:
  - `combo.ts`:
    - `type TierId = "terminal" | "ice" | "neon" | "gold" | "fever" | "cold"`;
    - `COLD_MS = 20_000`;
    - `isWin(t: ClosedTrade): boolean` (`pnlLamports > 0`);
    - `comboCount(closes: readonly ClosedTrade[]): number` (trailing wins by `closedAt`);
    - `activeTier(closes: readonly ClosedTrade[], now: number): TierId`. Cold applies while the latest close is a loss
      and `now < closedAt + COLD_MS`. Otherwise: combo 0-1 terminal, 2 ice, 3 neon, 4 gold, 5 and up fever.
  - `tilt.ts`:
    - `consecutiveLosses(closes): number`;
    - `tiltUntil(closes, settings: Settings): number | null`, which is the latest loss's
      `closedAt + tiltCooldownMin * 60_000` when `consecutiveLosses >= tiltLosses`, else `null`.
  - `progression.ts`:
    - `UPGRADES = [{ id: "neon_sign", atSol: 0.1 }, { id: "plants_coffee", atSol: 0.5 }, { id: "second_row", atSol: 1 },
      { id: "trophy_wall", atSol: 2.5 }, { id: "space_window", atSol: 5 }, { id: "gold_vault", atSol: 10 }] as const`;
    - `type UpgradeId`;
    - `peakCumulativeLamports(closes): bigint`;
    - `unlockedUpgrades(closes): UpgradeId[]`.

- [ ] **Step 1: Write failing tests**:
  - `combo`:
    - empty input gives tier `terminal` and count 0;
    - two wins give `ice`;
    - five wins give `fever`;
    - four wins then a loss give `cold` at +5s and `terminal` at +21s;
    - a breakeven close (`pnlLamports "0"`) resets the combo to 0.
  - `tilt`: three losses at t=1000, 2000, 3000 with defaults give `3000 + 600_000`; win, loss, loss gives `null`.
  - `progression`: cumulative +0.6 SOL followed by losses down to +0.2 still returns `["neon_sign", "plants_coffee"]`.
- [ ] **Step 2: Run** `npx vitest run test/combo.test.ts test/tilt.test.ts test/progression.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add combo, tilt, and progression rules`.

### Task 4: Statistics and experiment verdict

**Files:**
- Create: `src/shared/stats.ts`
- Test: `test/stats.test.ts`

**Interfaces:**
- Consumes: `ClosedTrade`, `CheckResult`, `Launch`, `ExitReason`, `RuleId` (Task 2).
- Produces:

```ts
export type ExperimentVerdict = { kind: "collecting"; needed: number } | { kind: "losing" } | { kind: "not_losing" };
export interface Stats { trades: number; wins: number; losses: number; winRate: number; avgWinSol: number;
	avgLossSol: number; profitFactor: number | null; expectancySol: number; expectancyCi90: [number, number] | null;
	bestSol: number | null; worstSol: number | null; realizedSol: number; cumulative: { at: number; sol: number }[];
	pnlByHour: number[]; holds: { holdSec: number; pnlSol: number }[]; exitReasons: Record<ExitReason, number>;
	verdict: ExperimentVerdict }
export interface LaunchStats { perHour: number[]; checked: number; approved: number; passRate: number;
	topRejections: { rule: RuleId; count: number }[] }
export function computeStats(closes: readonly ClosedTrade[], tzOffsetMin: number): Stats;
export function computeLaunchStats(launches: readonly Launch[], checks: readonly CheckResult[], now: number): LaunchStats;
export const VERDICT_MIN_CLOSES = 50;
```

- CI: `mean ± 1.645 * sampleSd / sqrt(n)` in SOL, `null` when `n < 2`.
- Verdict:
  - `collecting` while `n < 50`, with `needed: 50 - n`;
  - `losing` when the CI upper bound is below 0;
  - `not_losing` otherwise.
- `pnlByHour`: 24 buckets of realized SOL by local close hour.
- `perHour`: launches in each of the last 24 hours, oldest first.
- `topRejections`: counted from the first failing rule of each final rejected check, top 5.

- [ ] **Step 1: Write failing tests**:
  - Closes of +0.1, -0.05, +0.02, -0.01 SOL give:
    - `winRate 0.5`, `profitFactor 2`, `expectancySol` close to `0.015`;
    - `expectancyCi90` close to `[-0.037236, 0.067236]` (5 decimals);
    - verdict `{ kind: "collecting", needed: 46 }`.
  - 50 closes of -0.01 SOL give verdict `losing`.
  - 50 alternating +0.02 and -0.01 give `not_losing`.
  - Exit reasons are counted per reason.
  - `computeLaunchStats` with 4 checks (3 rejected: blocklist, blocklist, serial_launcher; 1 approved) gives:
    `passRate 0.25` and `topRejections[0]` equal to `{ rule: "blocklist", count: 2 }`.
- [ ] **Step 2: Run** `npx vitest run test/stats.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add trade statistics and experiment verdict`.

### Task 5: Bridge protocol

**Files:**
- Create: `src/shared/protocol.ts`
- Test: `test/protocol.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `Stats` and `LaunchStats` (Task 4), `SettingsSchema` (Task 2).
- Produces:
  - `PROTOCOL_VERSION = 1`.
  - zod schemas mirroring every Task 2 type.
  - `EngineSnapshotSchema` with fields:
    - `mode`, `synthetic`;
    - `feed: { status, dropped, reconnectAt }`;
    - `rpc: { publicFallback, degraded }`;
    - `launches: { launch, check }[]` (newest first, max 50);
    - `positions`, `closes` (newest 500);
    - `stats`, `launchStats`, `risk`, `settings`, `pinned: string[]`;
    - `balanceLamports`, `serverTime`.
  - `EngineEventSchema`, a discriminated union on `type`:
    - `hello { protocolVersion, mode, synthetic }`, `snapshot { snapshot }`;
    - `launch { launch }`, `check { check }`, `price { tick }`;
    - `order { order }`, `position { position }`, `close { trade }`;
    - `stats { stats, launchStats }`, `feed { status, dropped, reconnectAt }`;
    - `risk { risk }`, `balance { lamports }`, `settings { settings }`, `pinned { mints }`, `log { line }`.
  - `CommandSchema`, a union on `type`, each command with a client `id: string`:
    - `snipe { mint, holdConfirmed?: boolean }`, `sell { mint, pct: 50 | 100 }`;
    - `pin { mint }`, `unpin { mint }`;
    - `pause`, `resume`, `kill`;
    - `setSettings { patch: unknown }`.
  - `AckSchema { type: "ack", id, ok, error? }`.
  - `ServerMessageSchema = EngineEvent | Ack`.
  - Types `EngineSnapshot`, `EngineEvent`, `Command`, `Ack`, `ServerMessage`, and
    `CommandInput = DistributiveOmit<Command, "id">`.

- [ ] **Step 1: Write failing tests**:
  - A full snapshot event round-trips through `JSON.stringify`, then `EngineEventSchema.parse`, and stays deep-equal.
  - `CommandSchema` rejects `{ type: "sell", id: "1", mint: "x", pct: 30 }`.
  - It rejects an unknown `type`.
  - It accepts `snipe` without `holdConfirmed`.
- [ ] **Step 2: Run** `npx vitest run test/protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add bridge protocol schemas`.

### Task 6: Ledger

**Files:**
- Create: `src/engine/ledger/ledger.ts`
- Test: `test/ledger.test.ts`

**Interfaces:**
- Consumes: `Fill`, `ClosedTrade`, `Mode`, `ExitReason` (Task 2).
- Produces:

```ts
export type LedgerRecord = ({ kind: "fill" } & Fill)
	| { kind: "close"; positionId: string; mode: Mode; pnlLamports: string; pnlPct: number; reason: ExitReason; ts: number };
export interface OpenLot { positionId: string; mode: Mode; mint: string; symbol: string; openedAt: number;
	costLamports: bigint; proceedsLamports: bigint; tokenAmount: bigint }
export interface LedgerState { open: OpenLot[]; closed: ClosedTrade[]; warnings: string[] }
export class Ledger {
	constructor(filePath: string);
	load(): LedgerState;
	appendFill(fill: Fill): void;
	appendClose(record: Omit<Extract<LedgerRecord, { kind: "close" }>, "kind">): void;
	reset(): void;
}
export function rebuild(records: readonly LedgerRecord[]): Omit<LedgerState, "warnings">;
```

- Appends are synchronous `appendFileSync` lines, and the parent directory is created on first write.
- Per position:
  - cost = Σ buy (`solLamports + feesLamports`);
  - proceeds = Σ sell (`solLamports - feesLamports`);
  - tokens = Σ buy tokens − Σ sell tokens;
  - a position with a close record becomes a `ClosedTrade`, with `pnlLamports = proceeds - cost` and
    `pnlPct = pnl / cost * 100`.
- An unparseable line or a schema-invalid line adds the warning `Skipped malformed ledger line N`.

- [ ] **Step 1: Write failing tests**:
  - A buy plus a 50% sell plus a 50% sell plus a close rebuilds one `ClosedTrade` with the expected pnl.
  - A buy without a close gives one `OpenLot` with the right tokens.
  - A truncated last line loads all earlier records with one warning.
  - Garbage on line 2 of 5 is skipped with the warning `Skipped malformed ledger line 2`, and the other records load
    (Review Focus 5).
  - `reset()` empties the file.
- [ ] **Step 2: Run** `npx vitest run test/ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Validate each line with a zod schema derived from the Task 5 schemas.
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add append-only ledger`.

### Task 7: Engine foundations: clock, bus, codec, settings store

**Files:**
- Create: `src/engine/clock.ts`, `src/engine/bus.ts`, `src/engine/codec.ts`, `src/engine/settingsStore.ts`
- Test: `test/clock.test.ts`, `test/codec.test.ts`, `test/settingsStore.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Clock { now(): number; sleep(ms: number): Promise<void>; every(ms: number, fn: () => void): () => void }
export class RealClock implements Clock {}
export class ManualClock implements Clock { constructor(start?: number); advance(ms: number): Promise<void> }
export class EngineBus { emit(event: EngineEvent): void; on(listener: (event: EngineEvent) => void): () => void }
export function toJsonSafe(value: unknown): unknown;   // BN -> {"$bn":"…"}, PublicKey -> {"$pk":"…"}, bigint -> {"$big":"…"}
export function fromJsonSafe(value: unknown): unknown; // inverse, recursive over arrays and plain objects
export class SettingsStore { constructor(filePath: string, modeDefaults: Partial<Settings>); get(): Settings;
	update(patch: unknown): { ok: true; settings: Settings } | { ok: false; error: string } }
```

- `ManualClock.advance` runs due sleepers and intervals in time order, awaiting microtasks between them.
- `SettingsStore` creates the file from defaults merged with `modeDefaults`, and persists every accepted update. In live
  mode the defaults include `autoSnipe: false`.

- [ ] **Step 1: Write failing tests**:
  - `ManualClock`: `sleep(800)` resolves only after `advance(800)`, and intervals fire 3 times over `advance(3000)` at
    1000 ms.
  - `codec`: a decoded-shape object with BN, PublicKey, and bigint fields round-trips equal.
  - `SettingsStore`: an invalid update leaves the file bytes unchanged, a valid update persists, and a reload returns
    the update.
- [ ] **Step 2: Run** the three files with `npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add clock, event bus, codec, and settings store`.

### Task 8: PumpPortal feed

**Files:**
- Create: `src/engine/feed/types.ts`, `src/engine/feed/parse.ts`, `src/engine/feed/backoff.ts`,
  `src/engine/feed/pumpportal.ts`
- Test: `test/feed-parse.test.ts`, `test/feed-client.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 7), `Launch`, `FeedStatus` (Task 2).
- Produces:

```ts
export type FeedEvent = { type: "launch"; launch: Launch; raw: string } | { type: "migration"; mint: string }
	| { type: "status"; status: FeedStatus; dropped: number; reconnectAt: number | null };
export interface LaunchFeed { start(): void; stop(): void; on(listener: (e: FeedEvent) => void): () => void }
export type ParsedFeedMessage = { kind: "launch"; launch: Launch } | { kind: "migration"; mint: string }
	| { kind: "ack" } | { kind: "invalid" };
export function parsePumpPortalMessage(raw: string, receivedAt: number): ParsedFeedMessage;
export function isValidMint(value: unknown): value is string;  // base58, decodes to 32 bytes
export function backoffDelay(attempt: number, unit: number, jitter: number): number;
	// min(30_000, 1000 * 2^attempt) * (0.8 + 0.4 * unit); unit in [0,1)
export class PumpPortalFeed implements LaunchFeed {
	constructor(opts: { url: string; clock: Clock; captureFile: string | null; captureLimit: number;
		baseDelayMs?: number; jitterUnit?: () => number });
}
```

- Parsing:
  - `txType === "create"` with a valid `mint` is a launch, with fields read defensively (spec 4.1);
  - `txType` of `"migrate"` or `"migration"` with a valid `mint` is a migration;
  - an object with a string `message` and no `mint` is an ack;
  - anything else is invalid.
- Client behaviour:
  - Sends `{"method":"subscribeNewToken"}` and `{"method":"subscribeMigration"}` on open.
  - Counts invalid messages as `dropped`.
  - Writes the first `captureLimit` (50) raw messages to `captureFile`.
  - Uses one connection only.
  - Reconnects in a loop with `backoffDelay`, never by recursion.
  - `jitterUnit` defaults to `() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32`.

- [ ] **Step 1: Write failing tests**:
  - `feed-parse`:
    - a create message with all fields gives a launch with `marketCapSol` read;
    - a create message without `name` gives `name` equal to the symbol or `"UNKNOWN"`;
    - a message with an invalid mint gives `invalid`;
    - non-JSON gives `invalid`;
    - `{"message":"Successfully subscribed"}` gives `ack`;
    - `backoffDelay(10, 0.5, ...)` is capped at 30000.
  - `feed-client`, against a `ws` `WebSocketServer` on port 0:
    - the server receives both subscribe methods;
    - one valid and one garbage message give one launch event and `dropped: 1`;
    - when the server closes the socket, status goes `down`, then `live` again after reconnect with
      `baseDelayMs: 10`;
    - 60 messages produce a capture file of 50 lines.
- [ ] **Step 2: Run** `npx vitest run test/feed-parse.test.ts test/feed-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the `ws` package for the client.
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add PumpPortal launch feed`.

### Task 9: Chain source

**Files:**
- Create: `src/engine/chain/types.ts`, `src/engine/chain/rpcBudget.ts`, `src/engine/chain/pumpChain.ts`,
  `src/engine/chain/pumpPool.ts`
- Create: `test/helpers/fakeConnection.ts`, `test/helpers/curves.ts` (fixture `Global` and `BondingCurve` built with
  `newBondingCurve`, encoded with the SDK's Anchor coder via `getPumpProgram(connection).coder.accounts`)
- Test: `test/chain.test.ts`, `test/rpcBudget.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 7).
- Produces:

```ts
export interface Globals { global: Global; feeConfig: FeeConfig | null }
export type TokenProgramKind = "spl" | "token2022";
export interface CurveSnapshot { mint: string; curve: BondingCurve; tokenProgram: TokenProgramKind; slot: number; at: number }
export interface HolderSummary { supply: bigint; curveAccount: string; holders: { account: string; amount: bigint }[] }
export interface PoolSnapshot { mint: string; baseReserve: bigint; quoteReserve: bigint; slot: number; at: number;
	quote: PoolQuoteInputs }
export interface PoolQuoteInputs { globalConfig: GlobalConfig; feeConfig: AmmFeeConfig | null; baseMintAccount: RawMint;
	baseMint: PublicKey; coinCreator: PublicKey; creator: PublicKey; quoteMint: PublicKey; isMayhemMode: boolean;
	creatorFeeBps: BN }
export interface ChainSource {
	fetchGlobals(): Promise<Globals>;
	fetchCurve(mint: string): Promise<CurveSnapshot | null>;
	watchCurve(mint: string, onUpdate: (s: CurveSnapshot) => void): () => void;
	fetchHolders(mint: string, tokenProgram: TokenProgramKind): Promise<HolderSummary>;
	fetchPool(mint: string): Promise<PoolSnapshot | null>;
	watchPool(mint: string, onUpdate: (s: PoolSnapshot) => void): () => void;
	health(): { degraded: boolean };
}
export type ChainConnection = Pick<Connection, "getMultipleAccountsInfo" | "getAccountInfo" | "onAccountChange"
	| "removeAccountChangeListener" | "getTokenLargestAccounts" | "getTokenSupply">;
export class RpcBudget { constructor(maxPerSecond: number, clock: Clock); tryTake(cost?: number): boolean }
export class WatchLimitError extends Error {}
export class PumpChain implements ChainSource { constructor(conn: ChainConnection, budget: RpcBudget, clock: Clock) }
```

- `fetchCurve`:
  - one `getMultipleAccountsInfo([bondingCurvePda(mint), mint])` call;
  - decodes with `PUMP_SDK.decodeBondingCurve`;
  - the token program comes from the mint account's owner;
  - returns `null` when the curve account is missing.
- `watchCurve`:
  - `onAccountChange` plus a shared 2s batched poll (plan decision);
  - updates at or below the last seen slot are dropped;
  - at most 10 active watches across curves and pools, beyond which it throws `WatchLimitError`.
- `fetchHolders`:
  - calls `getTokenLargestAccounts` and `getTokenSupply`;
  - excludes the curve's associated token account (`getAssociatedTokenAddressSync(mint, curvePda, true, program)`).
- `fetchPool`:
  - uses `canonicalPumpPoolPda(mint)` and `PUMP_AMM_SDK.decodePool`;
  - reads the pool's base and quote token accounts, the base mint, and the AMM global and fee configs (configs cached
    for the process).
- `health().degraded`: true after 3 consecutive RPC errors, false after the next success.
- Every RPC call takes from the budget. Polls skip a tick when the budget is empty.

- [ ] **Step 1: Write failing tests**:
  - `rpcBudget`: 5/s allows 5 `tryTake()` and refuses the 6th until `advance(1000)`.
  - `chain`:
    - a fixture curve encoded into the fake connection decodes with the same reserves;
    - a missing account gives `null`;
    - a Token-2022-owned mint gives `"token2022"`;
    - two updates at slots 10 and 9 deliver only slot 10;
    - `advance(2000)` triggers one batched poll covering all watched accounts;
    - an 11th watch throws `WatchLimitError`;
    - `fetchHolders` drops the curve account;
    - 3 thrown RPC errors set `degraded`.
- [ ] **Step 2: Run** `npx vitest run test/rpcBudget.test.ts test/chain.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add chain source over the pump SDK`.

### Task 10: Quotes and paper executor

**Files:**
- Create: `src/engine/trader/quote.ts`, `src/engine/trader/executor.ts`, `src/engine/trader/paper.ts`
- Create: `test/helpers/fakeChain.ts` (in-memory `ChainSource` with `setCurve`, `setPool`, `setHolders`)
- Test: `test/quote.test.ts`, `test/paper.test.ts`

**Interfaces:**
- Consumes: Task 9 types, `units.ts`, `Settings`, `Clock`, `Fill`, `Mode`.
- Produces:

```ts
export function quoteBuyTokens(snap: CurveSnapshot, g: Globals, solLamports: bigint): bigint;
export function quoteSellLamports(snap: CurveSnapshot, g: Globals, tokenAmount: bigint): bigint;
export function quotePoolSellLamports(pool: PoolSnapshot, tokenAmount: bigint): bigint;  // sellBaseInput(...).uiQuote
export function curvePriceSol(curve: BondingCurve): number;      // (vQuote / 1e9) / (vToken / 1e6)
export function curveMarketCapSol(curve: BondingCurve): number;  // bondingCurveMarketCap(...) / 1e9
export function poolPriceSol(pool: PoolSnapshot): number;
export interface BuyRequest { positionId: string; mint: string; symbol: string; solLamports: bigint }
export interface SellRequest { positionId: string; mint: string; symbol: string; tokenAmount: bigint }
export type FillResult = { ok: true; fill: Fill } | { ok: false; error: string };
export interface Executor { readonly mode: Mode; buy(r: BuyRequest): Promise<FillResult>; sell(r: SellRequest): Promise<FillResult> }
export class PaperExecutor implements Executor {
	constructor(deps: { mode: Mode; chain: ChainSource; globals: () => Globals; clock: Clock; settings: () => Settings });
}
```

- Buy flow:
  1. Sleep `paper.latencyMs`.
  2. Fetch a fresh curve.
  3. Check the curve and fail with the matching message:
     - missing: `Curve not found`;
     - complete or migrated: `Coin migrated before fill`;
     - quote above `realTokenReserves`: `Buy exceeds remaining curve supply`.
  4. Record `tokenAmount = haircut(quoteBuyTokens, extraSlippageBps)`, `solLamports = request`, and
     `feesLamports = BASE_FEE + priorityFee + TOKEN_ACCOUNT_RENT`.
- Sell flow:
  1. Sleep, then fetch a fresh curve.
  2. If the curve is migrated, fetch the pool and quote it.
  3. Record `solLamports = haircut(quote)` and `feesLamports = BASE_FEE + priorityFee`.
  4. If neither curve nor pool is available, fail with `No price source`.

- [ ] **Step 1: Write failing tests**:
  - `quote`: `quoteBuyTokens` equals a direct `getBuyTokenAmountFromSolAmount` call on the same fixture, and so does
    the sell side; `curvePriceSol` on the fresh fixture curve is close to `(30 / 1_073_000_000) * 1e3` within 1e-12 for
    the fixture's 30 SOL / 1.073e15 reserves.
  - `paper`:
    - a buy is not resolved before `advance(799)` and is resolved at `advance(1)`;
    - the fill amounts and fees match the formulas above;
    - a curve set to complete during the latency fails with `Coin migrated before fill`;
    - a sell after migration uses the pool quote;
    - a sell with no curve and no pool fails with `No price source`.
- [ ] **Step 2: Run** `npx vitest run test/quote.test.ts test/paper.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add quote math and paper executor`.

### Task 11: Launch history, rug check, scout

**Files:**
- Create: `src/engine/scout/launchHistory.ts`, `src/engine/scout/rugcheck.ts`, `src/engine/scout/scout.ts`
- Test: `test/rugcheck.test.ts`, `test/scout.test.ts`

**Interfaces:**
- Consumes: `ChainSource`, `RpcBudget`, `Clock`, `Settings`, `Launch`, `CheckResult`.
- Produces:

```ts
export class LaunchHistory { constructor(filePath: string | null, clock: Clock); record(creator: string, mint: string, at: number): void;
	countInWindow(creator: string, windowMs: number, now: number): number }
export interface RugInput { launch: Launch; curve: BondingCurve; holders: HolderSummary | null; creatorLaunchesInWindow: number }
export const HARD_RULES: readonly RuleId[];  // quote_sol, not_mayhem, curve_live, blocklist, serial_launcher
export function evaluateRules(input: RugInput, rug: Settings["rug"]): RuleResult[];  // all 8, RuleId order
export class Scout { constructor(deps: { chain: ChainSource; budget: RpcBudget; history: LaunchHistory; clock: Clock;
	settings: () => Settings }); check(launch: Launch, attempt: number): Promise<CheckResult> }
```

- Rule semantics:
  - `quote_sol` passes when the quote mint is the zero key or WSOL.
  - `serial_launcher` counts this launch. The creator comes from the launch, or from `curve.creator` when the launch has
    none.
  - Holder rules use `HolderSummary` with the curve account excluded.
  - Results whose `pass` value cannot be computed because `holders` is `null` fail with reason `Holder data
    unavailable`.
- Reason copy, used verbatim in VERA's bubble:
  - `quote_sol`: `Priced in SOL` / `Not priced in SOL`;
  - `not_mayhem`: `Normal curve` / `Mayhem-mode coin`;
  - `curve_live`: `Curve live` / `Curve complete or migrated`;
  - `blocklist`: `Name clean` / `Name contains "<word>"`;
  - `serial_launcher`: `Creator launched <n> in <w>m` / `Serial launcher: <n> coins in <w>m`;
  - `top_holder`: `Top holder <p.1>% (max <m>%)`;
  - `holder_spread`: `<n> holders in top 20 (min <m>)`;
  - `min_real_sol`: `<s.2> SOL in curve (min <m>)`.
- `CheckResult.reason` is the first failing reason, or `All checks passed`.
- `Scout.check`:
  - takes 3 budget units, or returns `unchecked` with reason `RPC budget exhausted`;
  - a missing curve gives `rejected` with `Curve not found`;
  - a failed holder fetch keeps going with `holders: null`.

- [ ] **Step 1: Write failing tests**:
  - Each rule passes and fails with the exact reason strings.
  - Blocklist matching is case-insensitive, on both name and symbol.
  - The third launch by one creator within 60 minutes fails `serial_launcher`; a fourth launch 61 minutes after the
    first passes with count 3, then 2 once older launches leave the window.
  - With an empty budget, `Scout` returns `unchecked`.
  - `LaunchHistory` persists, reloads, and prunes entries older than 24h on load.
- [ ] **Step 2: Run** `npx vitest run test/rugcheck.test.ts test/scout.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add rug checks and launch history`.

### Task 12: Risk guard

**Files:**
- Create: `src/engine/risk/guard.ts`
- Test: `test/guard.test.ts`

**Interfaces:**
- Consumes: `ClosedTrade`, `Settings`, `RiskState`, `Clock`, `tiltUntil` (Task 3).
- Produces:

```ts
export type OpenKind = "auto" | "manual";
export function dailyPnlLamports(closes: readonly ClosedTrade[], now: number, tzOffsetMin: number): bigint;
export function nextLocalMidnight(now: number, tzOffsetMin: number): number;
export class RiskGuard {
	constructor(deps: { clock: Clock; settings: () => Settings; tzOffsetMin: () => number });
	state(closes: readonly ClosedTrade[]): RiskState;
	canOpen(kind: OpenKind, closes: readonly ClosedTrade[], openCount: number, opts: { holdConfirmed: boolean;
		checkVerdict: Verdict | null }): { ok: true } | { ok: false; reason: string };
	setPaused(paused: boolean, reason: string | null): void;
}
```

- Checks run in this order, and the first failure wins:
  1. `Engine paused`.
  2. `Max positions (<n>) reached`.
  3. Auto only:
     - `Auto-snipe off`;
     - `Daily loss cap hit` (until the next local midnight);
     - `Tilt cooldown until HH:MM`;
     - verdict not `approved`: `Not approved`.
  4. Manual only, while tilted or on a `rejected` verdict without `holdConfirmed`:
     - `Hold to confirm during tilt`;
     - `Hold to snipe a rejected coin`.
- `tzOffsetMin` defaults to `-new Date().getTimezoneOffset()`.

- [ ] **Step 1: Write failing tests**:
  - Each check produces its reason.
  - The daily cap releases at the next local midnight with offset -300 (US Central daylight time).
  - The tilt cooldown ends at the latest loss plus 10 min.
  - A manual buy during tilt with `holdConfirmed` succeeds.
  - `state()` reports `dailyPnlLamports` as a decimal string.
- [ ] **Step 2: Run** `npx vitest run test/guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add risk guard`.

### Task 13: Positions and exit rules

**Files:**
- Create: `src/engine/trader/positions.ts`
- Test: `test/positions.test.ts`

**Interfaces:**
- Consumes: `OpenLot` (Task 6), `Position`, `ExitReason`, `Settings`, `units.ts`.
- Produces:

```ts
export interface PositionState { id: string; mode: Mode; mint: string; symbol: string; openedAt: number; costLamports: bigint;
	proceedsLamports: bigint; tokenAmount: bigint; valueLamports: bigint | null; pnlPct: number | null; peakPnlPct: number;
	priceSol: number | null; priceAt: number | null; migrated: boolean; pendingOrder: boolean }
export function fromLot(lot: OpenLot): PositionState;
export function revalue(p: PositionState, valueLamports: bigint, priceSol: number, at: number): PositionState;
	// pnlPct = (value + proceeds - cost) / cost * 100; peak = max(peak, pnlPct)
export function isStale(p: PositionState, now: number, s: Settings): boolean;  // priceAt null or older than priceStaleSec
export function evaluateExit(p: PositionState, now: number, s: Settings): ExitReason | null;
export function toView(p: PositionState, now: number, s: Settings): Position;
```

- `valueLamports` passed to `revalue` is the paper sell quote with the haircut applied, minus base and priority fees.
  The caller computes it with Task 10's quote functions.
- `evaluateExit` returns `null` while an order is pending or the price is stale. Otherwise it checks, in order:
  1. `max_hold`;
  2. `stop_loss` (`pnlPct <= -stopLossPct`);
  3. `trailing` (`trailingStopPct > 0 && peak > 0 && pnlPct <= peak - trailingStopPct`);
  4. `take_profit` (`pnlPct >= takeProfitPct`).

- [ ] **Step 1: Write failing tests**:
  - Each exit fires at its exact boundary: TP at 100, SL at -30, max hold at 30 min.
  - A stale price blocks every exit, including `max_hold`.
  - A pending order blocks exits.
  - With trailing stop 20 and a peak of 60, the trailing exit fires at 40 and not at 41.
  - After a 50% sell, `revalue` includes the realized proceeds.
- [ ] **Step 2: Run** `npx vitest run test/positions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add positions and exit rules`.

### Task 14: Trading core

**Files:**
- Create: `src/engine/core/tradingCore.ts`
- Create: `test/helpers/fakeFeed.ts`
- Test: `test/tradingCore.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-13.
- Produces:

```ts
export interface CoreDeps { mode: Mode; synthetic: boolean; feed: LaunchFeed; chain: ChainSource; executor: Executor;
	ledger: Ledger; history: LaunchHistory; scout: Scout; risk: RiskGuard; budget: RpcBudget; clock: Clock; bus: EngineBus;
	settings: SettingsStore; publicRpcFallback: boolean; tzOffsetMin: () => number; onRaw?: (raw: string) => void }
export class TradingCore {
	constructor(deps: CoreDeps);
	start(): Promise<void>;
	stop(): Promise<void>;
	snapshot(): EngineSnapshot;
	handleCommand(cmd: Command): Promise<Ack>;
}
```

- `start`:
  - loads the ledger (logging warnings as `log` events) and fetches globals;
  - rebuilds positions, then for each one: re-watches its curve; if the curve is migrated, watches the pool and sets
    `migrated`; if neither exists, leaves it stale;
  - starts the feed and a 1s ticker that emits `position` for positions whose `stale` flag changed.
- Launch flow:
  1. On a launch, emit `launch` and keep the newest 50.
  2. Run the check after `snipeDelaySec`. Re-check soft-only rejections at each `recheckDelaysSec` offset from launch.
  3. On `approved`, ask `RiskGuard` with kind `auto`. If allowed, buy `solToLamports(buySol)`, emitting `order` pending
     then filled or failed, and on fill `position`, `balance`, and a ledger fill.
- Price handling:
  - A curve or pool update revalues the position and emits `price` and `position`.
  - When `evaluateExit` returns a reason, sell 100% with source `exit`.
- On a full exit:
  - append the close record, emit `close`, `stats`, and `risk`, then unwatch the coin;
  - a 50% manual sell keeps the position open.
- Paper balance = `startingBalance + realized PnL − cost of open positions`. A buy above the balance fails with
  `Insufficient paper balance`.
- Commands:
  - `snipe`: a manual buy, refused with `Already holding` or `Order already pending`;
  - `sell`: refused with `No open position`;
  - `pin` / `unpin`: watch at most 10 coins together with open positions, refusing with `Watch limit reached`;
  - `pause` / `resume`: through `RiskGuard`;
  - `kill`: sell every position with source `exit`, then pause with reason `Kill switch`;
  - `setSettings`: through `SettingsStore`, emitting `settings` on success.

- [ ] **Step 1: Write failing tests** with `FakeFeed`, `FakeChain`, `PaperExecutor`, `ManualClock`, and a temp-dir ledger:
  - Happy path: launch, approved, auto buy, a price raised so the pnl reaches 100%, an exit sell, and a `close` with
    reason `take_profit`. The ledger holds 2 fills and 1 close, and the bus saw events in that order.
  - Stop-loss path closes with `stop_loss`, and `risk.tiltLosses` becomes 1.
  - A soft rejection at +2s passes at the +10s re-check and then buys.
  - Burst: 20 launches with budget 5/s give at least 15 `unchecked`, no buys for those, and radar length at most 50
    (Review Focus 2).
  - Double snipe: two `snipe` commands for one mint, sent back to back, give one ack ok and one
    `Order already pending`, and a single fill (Review Focus 3).
  - An invalid `setSettings` patch gets an error ack, and the next snapshot shows unchanged settings (Review Focus 4).
  - Restart: a ledger with an open lot whose curve is now migrated and a pool exists starts with `migrated: true`; with
    neither, it starts `stale: true`, and `start()` resolves (Review Focus 1).
  - `kill` sells all positions and pauses.
- [ ] **Step 2: Run** `npx vitest run test/tradingCore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add trading core orchestration`.

### Task 15: Bridge server

**Files:**
- Create: `src/engine/bridge/server.ts`
- Test: `test/bridge.test.ts`

**Interfaces:**
- Consumes: `TradingCore` (`snapshot`, `handleCommand`), `EngineBus`, protocol schemas.
- Produces:

```ts
export class BridgeServer {
	constructor(opts: { port: number; staticDir: string; core: Pick<TradingCore, "snapshot" | "handleCommand">;
		bus: EngineBus; token: string; mode: Mode; synthetic: boolean });
	listen(): Promise<{ url: string; port: number }>;  // binds 127.0.0.1; port 0 picks a free port
	close(): Promise<void>;
}
export function createSessionToken(): string;  // randomBytes(24).toString("base64url")
```

- HTTP:
  - A `Host` header other than `127.0.0.1:<port>` or `localhost:<port>` gets 421 (DNS rebinding guard).
  - `GET /` serves `index.html`, with `%SNIPER_TOKEN%` in `<meta name="sniper-token" content="%SNIPER_TOKEN%">`
    replaced.
  - Static files: paths resolving outside `staticDir` get 404. A missing `staticDir` gets 503, with body
    `Web app not built. Run npm run build:web.`
  - Header `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:<port> ws://localhost:<port>`.
- WebSocket (path `/ws?token=`):
  - The token is compared with `timingSafeEqual`. The `Origin` must be `http://127.0.0.1:<port>` or
    `http://localhost:<port>`. A failure gets 401 or 403, and the socket is destroyed.
  - On connect, send `hello`, then `snapshot`, then forward every bus event to every client.
  - Each command is validated. Its ack goes only to the sender; an invalid message gets
    `{ type: "ack", id: <id or "unknown">, ok: false, error: "Invalid command" }`.

- [ ] **Step 1: Write failing tests**:
  - A wrong `Host` gets 421.
  - The token is injected and the CSP header is present.
  - `/..%2fpackage.json` gets 404.
  - A websocket with no token is refused.
  - The good token with Origin `http://evil.example` is refused.
  - A good client receives `hello` then `snapshot`.
  - A valid command gets its ack; invalid JSON gets an error ack.
  - Two clients both receive a bus event (Review Focus 3).
  - A missing static dir gets 503 with the body above.
- [ ] **Step 2: Run** `npx vitest run test/bridge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:http` and `ws` `WebSocketServer({ noServer: true })`.
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add loopback bridge server`.

### Task 16: Replay, recording, synthetic demo

**Files:**
- Create: `src/engine/replay/recording.ts`, `src/engine/replay/recorder.ts`, `src/engine/replay/player.ts`,
  `src/engine/replay/synthetic.ts`, `scripts/make-demo.ts`, `fixtures/demo-session.jsonl` (generated, committed)
- Test: `test/replay.test.ts`, `test/demo.test.ts`

**Interfaces:**
- Consumes: `LaunchFeed`, `ChainSource`, codec, `Clock`, SDK `newBondingCurve`, and the Task 10 quote functions.
- Produces:

```ts
export type RecordingLine = { t: number; kind: "meta"; synthetic: boolean; description: string; createdAt: string }
	| { t: number; kind: "globals"; globals: unknown } | { t: number; kind: "launch"; raw: string }
	| { t: number; kind: "curve"; mint: string; snap: unknown } | { t: number; kind: "holders"; mint: string; holders: unknown }
	| { t: number; kind: "pool"; mint: string; pool: unknown } | { t: number; kind: "feed"; status: FeedStatus };
export function readRecording(path: string): RecordingLine[];
export class Recorder { constructor(path: string, clock: Clock); wrapChain(chain: ChainSource): ChainSource; launchRaw(raw: string): void;
	feedStatus(s: FeedStatus): void }
export class ReplayFeed implements LaunchFeed {}
export class ReplayChain implements ChainSource {}
export class ReplayDriver { constructor(lines: RecordingLine[], clock: Clock, speed: number); feed: ReplayFeed; chain: ReplayChain;
	readonly synthetic: boolean; start(): void; stop(): void }
export function buildDemoSession(seed: number): RecordingLine[];
```

- Recording times `t` are milliseconds from the session start. The driver dispatches each line at `t / speed`.
- `ReplayChain`:
  - `fetchCurve` returns the newest snap at or before the current time;
  - watchers fire as lines dispatch;
  - `fetchHolders` and `fetchPool` read their own lines.
- Demo beats. Times are seconds; at most 3 positions are open at once; synthetic `Global` uses `feeConfig: null`:

| t | Beat | Expected outcome |
|---|---|---|
| 0 | meta, globals, feed live | |
| 3 | `ALPHA` | approved, rises to a take-profit win |
| 8 | `RUGPULL` | rejected by blocklist |
| 12 | `BETA` | approved, win |
| 15 | `SPAMA`, `SPAMB`, `SPAMC` from one creator | `SPAMC` rejected as serial launcher |
| 20 | `MAYHEM` | rejected, mayhem mode |
| 25 | `GAMMA` | approved, win |
| 32 | `DELTA` | approved, win |
| 45 | `EPSILON` | approved, win (FEVER) |
| 95-105 | feed down | ZORP asleep |
| 110 | `ZETA` | approved, stop-loss loss |
| 120 | `ETA` | approved, curve completes during fill latency, order fails |
| 130 | `THETA` | approved, stop-loss loss |
| 140 | `IOTA` | approved, stop-loss loss, tilt pause begins |
| 150 | `KAPPA` | low real SOL, rejected at +2s, passes the +10s re-check, not bought because of tilt (`log` names the tilt) |
| 200 | end | |

- [ ] **Step 1: Write failing tests**:
  - `replay`:
    - a recorder wrapping a `FakeChain` writes lines that the player reads back;
    - the replayed `fetchCurve` at t equals the recorded snap at t;
    - at speed 2, a line at t=1000 dispatches at `advance(500)`.
  - `demo`, running `buildDemoSession(7)` through the full `TradingCore` with `ManualClock`, `PaperExecutor`, and
    default settings:
    - closes are 5 `take_profit` followed by 3 `stop_loss`;
    - one failed order with error `Coin migrated before fill`;
    - rejections include `blocklist`, `serial_launcher`, and `not_mayhem`;
    - `activeTier` passes through `ice`, `neon`, `gold`, `fever`, and `cold`;
    - a feed `down` status is emitted;
    - `risk.tiltUntil` is not `null` after `IOTA`;
    - `KAPPA` is approved on attempt 2 with no buy.
- [ ] **Step 2: Run** `npx vitest run test/replay.test.ts test/demo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Generate price paths by applying scripted SOL buys and sells to the curve's virtual and real
  reserves with a seeded mulberry32 PRNG. Then run `npm run make-demo` to write `fixtures/demo-session.jsonl`, with
  meta `synthetic: true` and description `SYNTHETIC DEMO generated by scripts/make-demo.ts`.
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add replay, recording, and synthetic demo`.

### Task 17: Engine entrypoint and configuration

**Files:**
- Create: `src/engine/cli.ts`, `src/engine/env.ts`, `src/engine/main.ts`
- Test: `test/cli.test.ts`, `test/engine-smoke.test.ts`

**Interfaces:**
- Consumes: all engine modules.
- Produces:

```ts
export interface CliOptions { demo: boolean; replayFile: string | null; record: boolean; speed: number; port: number | null;
	staticDir: string | null }
export function parseArgs(argv: readonly string[]): CliOptions;  // --demo --replay <file> --record --speed <n> --port <n> --static-dir <dir>
export interface EnvConfig { rpcUrl: string; rpcWsUrl: string; mode: "paper" | "live"; keypairPath: string | null; port: number;
	rpcMaxRps: number; publicFallback: boolean }
export function readEnv(env: Record<string, string | undefined>): EnvConfig;
	// RPC_URL default https://api.mainnet-beta.solana.com (publicFallback true); RPC_WS_URL from RPC_URL (https->wss, http->ws)
```

- `main.ts`:
  - Loads `.env` with `process.loadEnvFile` when it exists, and resolves `data/` and `dist/web` relative to the app root.
  - Picks the mode:
    - `--demo` gives `demo`, reading `fixtures/demo-session.jsonl`;
    - `--replay` gives `replay`;
    - otherwise `MODE`, where `live` exits with code 1 and `Live mode arrives in Milestone 2. Set MODE=paper.`.
  - Resets the ledger for replay and demo.
  - Wires `Connection(rpcUrl, { wsEndpoint: rpcWsUrl, commitment: "confirmed" })`, the core, and the bridge.
  - Prints `SUPER C SNIPER  mode=<MODE>  <url>`, plus `Warning: using the public Solana RPC; set RPC_URL for reliable
    data.` when using the public fallback.
  - On `SIGINT`, stops cleanly.

- [ ] **Step 1: Write failing tests**:
  - `cli`: argument parsing for each flag; `readEnv({})` gives `publicFallback: true` and the wss URL derived; `MODE=live`
    is preserved.
  - `engine-smoke`:
    - spawn `npx tsx src/engine/main.ts --demo --speed 50 --port 0 --static-dir <tmp with index.html containing the
      meta tag>`;
    - parse the printed URL;
    - `GET /` contains a 32-character base64url token;
    - a websocket with that token and the matching `Origin` receives `hello` with `mode: "demo"`, `synthetic: true`;
    - the child exits after `SIGINT`.
- [ ] **Step 2: Run** `npx vitest run test/cli.test.ts test/engine-smoke.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add engine entrypoint and configuration`.

### Task 18: Web shell, store, HUD

**Files:**
- Create: `src/web/App.tsx`, `src/web/styles.css`, `src/web/net/bridgeClient.ts`, `src/web/state/store.ts`,
  `src/web/state/useGame.ts`, `src/web/hud/{TopBar,Radar,Positions,Hotbar,EventLog,SettingsPanel,Offline,Banner}.tsx`,
  `src/web/hud/keybindings.ts`
- Modify: `src/web/main.tsx`, `index.html` (meta tag `sniper-token` with `%SNIPER_TOKEN%`, fonts imported in `main.tsx`)
- Test: `test/store.test.ts`, `test/keybindings.test.ts`

**Interfaces:**
- Consumes: protocol (Task 5), `activeTier` and `comboCount` (Task 3), `unlockedUpgrades` (Task 3).
- Produces:

```ts
export type ConnectionStatus = "connecting" | "open" | "closed";
export class BridgeClient { constructor(url: string, token: string); connect(): void; close(): void;
	onEvent(fn: (e: EngineEvent) => void): () => void; onStatus(fn: (s: ConnectionStatus) => void): () => void;
	send(cmd: CommandInput): Promise<Ack> }  // reconnect 1s doubling to 10s; pending sends reject on close
export interface GameState { connection: ConnectionStatus; snapshot: EngineSnapshot | null; combo: number; tier: TierId;
	upgrades: UpgradeId[]; selectedMint: string | null; log: LogLine[]; now: number }
export function initialGameState(): GameState;
export function reduce(state: GameState, event: EngineEvent): GameState;
export function tick(state: GameState, now: number): GameState;  // recomputes tier for cold expiry
export type ActionId = "hotbar1" | "hotbar2" | "hotbar3" | "hotbar4" | "hotbar5" | "hotbar6" | "radarUp" | "radarDown"
	| "snipeSelected" | "analytics" | "mute" | "pause" | "kill";
export const DEFAULT_KEYBINDINGS: Record<ActionId, string>;
	// "1".."6", "ArrowUp", "ArrowDown", "s", "Tab", "m", "p", "k"
export function loadKeybindings(): Record<ActionId, string>;  // localStorage, try/catch, falls back to defaults
export function saveKeybindings(b: Record<ActionId, string>): void;
export function actionForKey(b: Record<ActionId, string>, key: string): ActionId | null;
```

- `App`:
  - Reads the token from the meta tag and connects to `ws://<host>/ws?token=`.
  - Ticks every 1s and sets `document.documentElement.dataset.tier` and `dataset.reducedMotion`.
  - CSS variables for HUD colors come from the active tier palette (Task 19 exports `hudColors(tier)`).
- `Offline` shows CRT static with `ENGINE OFFLINE` and a reconnect countdown whenever the connection is not `open`.
- Layout, per spec 7.6:
  - Desktop: grid `300px 1fr 320px`, with the top bar and bottom hotbar plus log.
  - Tablet (768-1199px): tabs.
  - Phone (under 768px): scene at the top at 40vh, panels stacked.
- `K` kill and manual SNIPE during tilt or on a rejected coin require a 1.5s hold with a visible fill ring, then send
  `holdConfirmed: true`.
- Banner `COMBO xN` on combo increases of 2 and up. Mute is on by default.
- `SettingsPanel` edits every `Settings` field and shows the ack error inline.

- [ ] **Step 1: Write failing tests**:
  - `store`:
    - a snapshot sets state;
    - a launch prepends and caps at 50;
    - a check attaches to its launch;
    - a position upserts;
    - a close removes the position, appends the trade, and recomputes combo and tier;
    - a feed status updates;
    - `tick` turns `cold` into `terminal` after 20s.
  - `keybindings`: defaults map `"k"` to `kill`; a corrupt localStorage value falls back to defaults; a rebinding
    persists.
- [ ] **Step 2: Run** `npx vitest run test/store.test.ts test/keybindings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check` and `npm run build:web`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add web shell, store, and HUD`.

### Task 19: Scene renderer, palettes, office

**Files:**
- Create: `src/web/scene/palettes.ts`, `src/web/scene/shaders.ts`, `src/web/scene/renderer.ts`,
  `src/web/scene/voxel.ts`, `src/web/scene/office.ts`, `src/web/scene/monitors.ts`, `src/web/scene/SceneView.tsx`
- Test: `test/palettes.test.ts`, `test/voxel.test.ts`

**Interfaces:**
- Consumes: `TierId`, `UpgradeId`, `GameState`.
- Produces:

```ts
export const BASE_PALETTE: readonly string[];  // 16 hex, index order below
export function paletteFor(tier: TierId, timeMs: number, reducedMotion: boolean): Float32Array;  // 48 floats, 0..1
export function hudColors(tier: TierId): { bg: string; panel: string; text: string; accent: string; danger: string };
export type Voxel = readonly [x: number, y: number, z: number, w: number, h: number, d: number, color: number];
export function buildVoxelMesh(boxes: readonly Voxel[]): Mesh;  // merged BufferGeometry, vertex colors from BASE_PALETTE
export class PixelRenderer { constructor(canvas: HTMLCanvasElement); setTier(tier: TierId): void; setShake(px: number): void;
	setReducedMotion(on: boolean): void; render(scene: Scene, camera: Camera, timeMs: number): void; resize(): void; dispose(): void }
export interface Office { root: Group; anchors: Record<CastId, Vector3>; setUpgrades(ids: readonly UpgradeId[]): void }
export function buildOffice(): Office;
export class MonitorTextures { constructor(); textures: Record<"scout" | "analyst" | "trader" | "cfo" | "wall", CanvasTexture>;
	update(state: GameState): void }  // redraws at most every 250ms
```

- `BASE_PALETTE`, in index order:
  - 0-5: `#0b0d17` `#1b2138` `#2e3a5c` `#4f5d82` `#8a96b8` `#e8ecf4`;
  - 6-11: `#5a3a2a` `#9c6b43` `#f2c9a0` `#b07850` `#3fd16b` `#8e5bd6`;
  - 12-15: `#e04848` `#f2c94c` `#39c6e0` `#ff5fa2`.
- Tier palettes mix every color toward the tier tint:

| Tier | Tint | Mix | Extra |
|---|---|---|---|
| terminal | `#3fd16b` | 0.0 | |
| ice | `#39c6e0` | 0.25 | |
| neon | `#ff5fa2` | 0.25 | |
| gold | `#f2c94c` | 0.3 | |
| cold | `#4a6fa5` | 0.35 | desaturated 60% |
| fever | cycles hues 0, 60, 120, 180, 240, 300 every 500 ms | 0.3 | fixed gold when reduced motion is on |

- Renderer:
  - Internal target 320x180 with `NearestFilter`, then a quantize pass (4x4 Bayer, nearest palette color), then a CRT
    pass to the canvas.
  - The CRT pass draws scanlines at 180 lines, barrel curvature 0.08, a vignette, and chroma offset per tier: 0, 0.5,
    1, 1.5, 2.5 px for terminal through fever, 0 for cold.
  - Orthographic isometric camera at (10, 10, 10) looking at the origin.
  - The render loop pauses on `document.hidden`.
- Office:
  - Floor 24x16 voxels, two walls, a big wall screen, five desks with CRT monitors (anchors for the cast).
  - Upgrade props hidden until unlocked: neon sign, plants with a coffee machine, a second desk row with an intern
    alien, a trophy wall, a space window, a gold vault door.

- [ ] **Step 1: Write failing tests**:
  - `palettes`:
    - every tier returns 48 floats in [0, 1];
    - `terminal` equals `BASE_PALETTE`;
    - `cold` color 10 has lower saturation than the base;
    - `fever` at t=0 and t=500 differ, and is identical with reduced motion.
  - `voxel`: 3 boxes give 72 vertices and 108 indices.
- [ ] **Step 2: Run** `npx vitest run test/palettes.test.ts test/voxel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check` and `npm run build:web`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add pixel renderer, palettes, and office scene`.

### Task 20: Cast, director, effects, audio

**Files:**
- Create: `src/web/scene/cast/defs.ts`, `src/web/scene/cast/character.ts`, `src/web/scene/director.ts`,
  `src/web/scene/effects.ts`, `src/web/audio/sfx.ts`
- Modify: `src/web/scene/SceneView.tsx` (adds the cast, director, and effects)
- Test: `test/director.test.ts`

**Interfaces:**
- Consumes: `EngineEvent`, `GameState`, `Voxel`, `buildVoxelMesh`, `Office.anchors`.
- Produces:

```ts
export type CastId = "zorp" | "vera" | "rex" | "gloop" | "ceo";
export type CharacterState = "idle" | "work" | "celebrate" | "alarm" | "sleep" | "fail" | "dance" | "sweat";
export const CAST_DEFS: Record<CastId, { parts: Record<"head" | "body" | "armL" | "armR" | "legL" | "legR" | "prop", Voxel[]> }>;
export class Character { constructor(id: CastId); readonly root: Group; setState(s: CharacterState, ms?: number): void;
	setBubble(text: string | null, ms?: number): void; update(dtMs: number): void }
export type Reaction = { cast: CastId; state: CharacterState; ms: number; bubble?: string }
	| { effect: "coins" | "confetti"; count: number } | { effect: "shake"; px: number; ms: number }
	| { effect: "banner"; text: string } | { sfx: SfxId };
export function reactionsFor(prev: GameState, next: GameState, event: EngineEvent): Reaction[];
export type SfxId = "launch" | "approve" | "reject" | "fill" | "combo" | "loss" | "fever";
export class Sfx { setMuted(m: boolean): void; play(id: SfxId): void }  // AudioContext created on first unmute
```

- Proportions: head 6x6x6, body 4x5x3, arms 1x4x1, legs 1x3x1. Features per spec 7.3:
  - ZORP: antenna, headset;
  - VERA: bob hair, glasses, clipboard;
  - REX: pinstripes, slick hair, sunglasses;
  - GLOOP: three eyes, monocle, tie;
  - CEO: suit, desk nameplate.

  Colors are indexes into `BASE_PALETTE`.
- `reactionsFor` mapping (spec 7.3, 7.5):

| Event | Reactions |
|---|---|
| `launch` | ZORP `celebrate` 1200 ms, sfx `launch` |
| `check` approved | VERA `celebrate` 2500 ms with bubble `APPROVED`, sfx `approve` |
| `check` rejected | VERA `alarm` 2500 ms with bubble = `check.reason`, ZORP `alarm` 2000 ms, sfx `reject` |
| `feed` down | ZORP `sleep` 0 ms (held until `feed` live sets `idle`) |
| `order` pending | REX `work` 0 ms (held until filled or failed) |
| `order` filled | REX `celebrate` 1500 ms, sfx `fill` |
| `order` failed | REX `fail` 2000 ms with bubble = `order.error` |

  On a `close` win:
  - GLOOP `celebrate` 2000 ms;
  - if combo ≥ 2: banner `COMBO x<n>` and sfx `combo`;
  - if combo ≥ 3: coins 40 and shake 2 px for 400 ms;
  - if combo ≥ 4: every cast member `dance` 3000 ms;
  - if combo ≥ 5: confetti 120, shake 4 px for 600 ms, sfx `fever`, CEO `dance` 0 ms (held while fever).

  On a `close` loss: GLOOP `sweat` 2500 ms, sfx `loss`.

  CEO mood: session PnL above 0 gives `celebrate`-idle, at or below −0.05 SOL gives `sweat`, otherwise `idle`.
- Effects skip shake, coins, and confetti when reduced motion is on.

- [ ] **Step 1: Write failing tests**: `director`, one case per table row, plus combo 1→2 gives the banner `COMBO x2`;
  4→5 gives `fever` sfx and confetti; a loss gives GLOOP `sweat`.
- [ ] **Step 2: Run** `npx vitest run test/director.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check` and `npm run build:web`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add cast, director, effects, and sound`.

### Task 21: Analytics terminal

**Files:**
- Create: `src/web/hud/Analytics.tsx`, `src/web/hud/charts.ts`
- Modify: `src/web/App.tsx` (Tab key and GLOOP monitor click open it, Escape closes it)
- Test: `test/charts.test.ts`

**Interfaces:**
- Consumes: `Stats`, `LaunchStats`, `hudColors`, `paletteFor`.
- Produces:

```ts
export function scaleLinear(domain: [number, number], range: [number, number]): (v: number) => number;
export function niceTicks(min: number, max: number, count: number): number[];
export function drawLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], box: Box, colors: ChartColors): void;
export function drawBars(ctx: CanvasRenderingContext2D, values: number[], labels: string[], box: Box, colors: ChartColors): void;
export function drawScatter(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], box: Box, colors: ChartColors): void;
export function verdictCopy(v: ExperimentVerdict): { text: string; tone: "neutral" | "bad" | "good" };
```

- Panels: cumulative PnL (line), per-trade PnL (bars, red below zero), exit reasons (bars), launches per hour and pass
  rate (bars), hold time against PnL (scatter), expectancy with its 90% CI, and the verdict.
- Verdict copy:
  - collecting: `Need <n> more closes for a verdict`;
  - losing: `Strategy is losing money` (`bad`);
  - not losing: `No evidence of losing money (90% CI)` (`good`).
- Load the `dataviz` skill before writing chart code.

- [ ] **Step 1: Write failing tests**: `scaleLinear([0, 10], [0, 100])(5) === 50`; `niceTicks(0, 0.37, 4)` equals
  `[0, 0.1, 0.2, 0.3, 0.4]`; all three verdict copy strings.
- [ ] **Step 2: Run** `npx vitest run test/charts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `npm run check` and `npm run build:web`.
- [ ] **Step 5: Commit**: `feat(solana-tycoon): add analytics terminal`.

### Task 22: End-to-end, README, acceptance

**Files:**
- Create: `playwright.config.ts`, `e2e/demo.spec.ts`, `README.md`
- Test: `e2e/demo.spec.ts`

**Interfaces:**
- Consumes: the whole app.
- `playwright.config.ts`:
  - `webServer`: `npm run build:web && npx tsx src/engine/main.ts --demo --speed 4 --port 7788`, `url`
    `http://127.0.0.1:7788`;
  - Chromium `launchOptions.executablePath` from `PW_CHROMIUM_PATH` when set (the build container sets it to
    `/opt/pw-browsers/chromium`);
  - timeout 180s.

- [ ] **Step 1: Write the e2e tests** in `e2e/demo.spec.ts`:
  - The badge shows `SYNTHETIC DEMO`.
  - The canvas is non-blank: a screenshot's pixel variance is above 0.
  - `html[data-tier]` becomes `ice`, then `fever`, then `cold`.
  - The radar shows a `REJECTED` row with `Name contains "rug"`.
  - With `reducedMotion: "reduce"`, `html[data-reduced-motion="true"]`.
  - Screenshots at 1440x900 and 390x844 are saved to `test-results/screenshots/`.
- [ ] **Step 2: Run** `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`. Expected: FAIL on the first
  run only if anything above is missing; fix the app (not the test) until PASS.
- [ ] **Step 3: Write `README.md`**:
  - what the app is;
  - requirements (Node 22.12+);
  - setup (`cp .env.example .env`, set `RPC_URL`);
  - `npm start`, `npm run demo`, `npm run replay -- <file>`, `--record`;
  - every config key and setting with its default;
  - paper vs live (live arrives in Milestone 2);
  - the failure-mode table from spec Section 8, each row with the owner action;
  - where data lives (`data/`), how to reset paper results (delete `data/ledger.paper.jsonl`);
  - security notes (loopback only, token, never paste a key into the browser).
- [ ] **Step 4: Acceptance pass**, all commands from `apps/solana-tycoon/`:
  - `npx vitest run` (all unit and integration tests) passes;
  - `npm run check` is clean;
  - the e2e suite passes;
  - `grep -rnE "TODO|FIXME|lorem|Math\.random" src scripts` returns nothing;
  - `npm ls --all --json` licenses are MIT, ISC, Apache-2.0, BSD, or OFL-1.1 only, with any exception listed in the
    README;
  - view both screenshots.
- [ ] **Step 5: Commit**: `docs(solana-tycoon): add README and end-to-end demo tests`.
