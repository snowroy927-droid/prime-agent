# SUPER C SNIPER: Tycoon Trading Floor - Design Spec

Date: 2026-10-15
Status: Approved in conversation, awaiting written-spec review
Location: `apps/solana-tycoon/`

## 1. Intent

A personal command center for pump.fun trading on Solana. It replaces the uploaded `dashboard.jsx` (fully simulated)
and `solana_sniper.py` (live mode never signs a transaction) with:

- A trading engine that runs on the owner's machine, reads real launches and real on-chain state, and trades through the
  official pump.fun SDK.
- A gamified dashboard: an isometric, low-resolution 3D "tycoon" trading floor staffed by chibi characters, with combo
  tiers that change the whole screen's palette and intensity as real winning trades stack up.

Every number on screen comes from real data: a launch stream, on-chain account state, or the engine's ledger of closed
trades. Nothing is randomized. Paper mode simulates only the fill, using the program's own price and fee math against
live state.

### Decisions made with the owner

| Topic | Decision |
|---|---|
| Audience | Personal command center for one wallet. No accounts, no hosted backend. |
| Money control | Dashboard controls the engine: SNIPE, SELL, hotbar, pause, kill switch. |
| Engine | TypeScript (Node 22) on `@pump-fun/pump-sdk`. The Python bot is retired. |
| Data budget | Free sources only. No paid PumpPortal trade streams. |
| Rollout | Milestone 1 is paper mode at real prices. Milestone 2 adds live signing behind caps. |
| Name | SUPER C SNIPER, from the uploaded `superCsniper_by.CR_files.zip`. |

### Money mechanism

This is a personal tool. It makes money only through the owner's own trading, and its job is to make that trading
measurable and disciplined. Live trading is labeled an experiment with a fixed budget (Section 9.4). Turning it into a
product is parked (Section 15).

### Non-goals

- Hosting, multi-user support, wallet-connect for other users.
- Coins quoted in anything other than SOL, and mayhem-mode coins (skipped with a visible reason).
- Analytics of trades placed outside the engine (Phantom manual trades).
- The Kraken SHIB/PEPE bot (`crypto_bot.py`).

## 2. Verified facts this design depends on

Checked 2026-10-15. Items marked unverified are handled defensively in the design.

| Fact | Source | Status |
|---|---|---|
| PumpPortal data websocket is `wss://pumpportal.fun/api/data`; clients must use one connection and send all subscriptions on it. | [PumpPortal real-time docs](https://pumpportal.fun/data-api/real-time/) via search | Verified (secondhand; direct fetch blocked) |
| Since 2026-05-01, `subscribeNewToken` and `subscribeMigration` are free; token/account trade streams need an API key, a linked wallet with at least 0.02 SOL, and cost 0.01 SOL per 10,000 events. | [PumpPortal fees](https://pumpportal.fun/fees/) via search | Verified (secondhand) |
| Exact field list of `subscribeNewToken` messages. | Not published in reachable docs | Unverified. Parser accepts unknown shapes; first 50 raw messages are saved as fixtures. |
| pump.fun has no public REST API; official interfaces are on-chain programs and SDKs. `frontend-api*.pump.fun` is unofficial. | [pump-public-docs](https://github.com/pump-fun/pump-public-docs), [community API notes](https://mintlify.com/BankkRoll/pumpfun-apis/api-versions) | Verified |
| `@pump-fun/pump-sdk` versions: 3.2.0 (2026-10-07), 4.0.0 (2026-10-08 12:53 UTC), 4.1.0 (2026-10-13). MIT. Depends on `@solana/web3.js` ^1.98.2, `@coral-xyz/anchor` ^0.31.1, `@pump-fun/pump-swap-sdk` ^1.13.0. | `npm view`, run 2026-10-15 | Verified |
| SDK exposes `PumpSdk.decodeBondingCurve`, `OnlinePumpSdk.fetchBuyState/fetchSellState`, `getBuyTokenAmountFromSolAmount`, `getSellSolAmountFromTokenAmount`, `getBuyV3TokenAmountFromQuoteAmount`, `bondingCurveMarketCap`, `isBondingCurveMigrated`, v3 builders `buyExactQuoteInV3Instructions` / `sellV3Instructions`. v3 refuses cashback coins (use v2). `create_v2` coins are Token-2022. | SDK 4.0.0 and 4.1.0 source, read 2026-10-15 | Verified |
| `three` 0.186.1 published 2026-09-24. | `npm view`, 2026-10-15 | Verified |
| Public RPC `api.mainnet-beta.solana.com` is rate-limited per IP and not meant for production. | [RPC Fast, 2026](https://rpcfast.com/blog/free-solana-rpc-endpoints) | Verified (secondhand). Exact limits of the owner's chosen free provider are unverified. |
| The build container cannot reach pump.fun, PumpPortal, Jupiter, or Solana RPC (proxy 403). | `curl`, 2026-10-15 | Verified. Live behavior is first exercised on the owner's machine. |

## 3. Architecture

```
                 owner's machine
 +---------------------------------------------------------+
 |  ENGINE (Node 22, TypeScript)                            |
 |                                                          |
 |  Feed (PumpPortal WS) --launch--> Scout --> RugCheck     |
 |                                      |          |        |
 |  Chain (RPC HTTP+WS, pump SDK) <-----+----------+        |
 |     | curve updates                             v        |
 |     +--> Positions <---- RiskGuard <---- Executor        |
 |              |                       (Paper | Live)      |
 |              v                                           |
 |           Ledger (JSONL) --> Stats/Combo (shared)        |
 |              |                                           |
 |  Bridge: HTTP + WS on 127.0.0.1:7777 (token + Origin)    |
 +--------------|------------------------------------------+
                v
   Browser: GAME (Vite build, React HUD + Three.js scene)
```

One process: the engine serves the built web app and the bridge websocket on the same port. `npm start` builds the web
app if needed and starts the engine.

### Directory layout

```
apps/solana-tycoon/
  package.json            own package, not part of the root npm workspaces
  .npmrc                  min-release-age=7 (mirrors repo policy)
  biome.json              tabs, width 120 (mirrors repo style)
  tsconfig.json
  vite.config.ts
  index.html
  .env.example
  README.md               setup, config, failure modes, runbook
  docs/specs/             this file
  src/shared/             protocol schemas, combo/tilt/stats logic, formatting
  src/engine/             main, config, feed, chain, scout, trader, risk, ledger, bridge, replay
  src/web/                app shell, hud, scene, audio, net, state
  test/                   unit and integration tests
  fixtures/               recorded and synthetic sessions, raw feed samples
  data/                   runtime output (gitignored): ledgers, settings, recordings
```

The root `biome.json` and `tsconfig.json` only include `packages/**`, so the repo's `npm run check` is unaffected. The
app has its own `check` script.

### Dependency pinning

Exact versions, each published at least 7 days before install (repo policy; local npm 10.9.4 does not enforce
`min-release-age`, so versions are pinned by hand and recorded in the app's lockfile):

- `@pump-fun/pump-sdk`: 4.0.0 if installed at or after 2026-10-15 12:53 UTC, otherwise 3.2.0.
- `@pump-fun/pump-swap-sdk`: the 1.x version the pump SDK resolves (1.20.0 at time of writing), so only one copy is
  installed.
- `@solana/web3.js` 1.x and `bn.js` matching the SDK's ranges.
- `three` 0.186.1. React 19, Vite, zod, vitest, Playwright: newest versions older than 7 days at install time.

## 4. Engine modules

All modules communicate through typed interfaces so each can be tested with fakes.

### 4.1 Feed (`src/engine/feed/pumpportal.ts`)

- One websocket to `wss://pumpportal.fun/api/data`; sends `{"method":"subscribeNewToken"}` and
  `{"method":"subscribeMigration"}` on open.
- Reconnect loop with exponential backoff (1s doubling to 30s, jittered), never recursive.
- Parser: reads `mint`, `name`, `symbol`, `traderPublicKey` (creator), `signature`, `uri`, `initialBuy`,
  `marketCapSol`, `bondingCurveKey` when present. A message without a valid base58 `mint` is dropped and counted.
  Unknown fields are ignored.
- Writes the first 50 raw messages per engine run to `data/fixtures/pumpportal-raw-<timestamp>.jsonl` to confirm the
  real schema.
- Emits `launch` and `migration` events and a feed status (`connecting | live | down`).

### 4.2 Chain (`src/engine/chain/`)

- `Connection` from `RPC_URL` (HTTP) and `RPC_WS_URL` (derived from `RPC_URL` when unset). Falls back to the public
  mainnet endpoint with a visible warning.
- `CurveWatcher`: `accountSubscribe` on bonding-curve PDAs for open positions and pinned coins, at most 10 at once.
  Decodes with `PUMP_SDK.decodeBondingCurve`. If the websocket drops, polls `getMultipleAccountsInfo` every 2s until it
  recovers.
- `PoolWatcher`: same for PumpSwap pools of migrated coins, via `@pump-fun/pump-swap-sdk`.
- Global RPC token bucket (`RPC_MAX_RPS`, default 5). Launches that cannot be checked within budget are marked
  `UNCHECKED (rate limit)` and never auto-sniped.

### 4.3 Rug check (`src/engine/scout/rugcheck.ts`)

Runs on a launch after `SNIPE_DELAY_SEC`. Each rule returns pass or fail with a one-line reason. A coin is snipeable only
if every rule passes.

| Rule | Default | Data |
|---|---|---|
| Quote mint is SOL | required | Bonding curve `quoteMint` |
| Not mayhem mode | required | Bonding curve `isMayhemMode` |
| Curve live (not complete, not migrated) | required | `complete`, `isBondingCurveMigrated` |
| Name/symbol blocklist | test, rug, scam, fake, honeypot | Launch message |
| Serial launcher | fail if the creator launched 3 or more coins in the last 60 min, counting this one | Engine's own launch history, persisted to `data/launches.jsonl`, pruned after 24h |
| Largest non-curve holder | at most 20% of supply | `getTokenLargestAccounts`, excluding the curve's token account |
| Holder spread | at least 10 non-empty accounts among the top 20 | `getTokenLargestAccounts` |
| Real SOL in curve | at least 1.0 SOL | Bonding curve `realQuoteReserves` |

Changed from the Python bot: its 5 SOL floor compared a SOL threshold against market cap. Real SOL in a fresh curve
starts at the creator's buy, so a 5 SOL floor would mean waiting for about 5 SOL of buys. Default is 1.0 SOL,
configurable.

Rug checks reduce risk. They do not detect intent, and the HUD says so in the analyst's tooltip.

### 4.4 Executor (`src/engine/trader/`)

```ts
interface Executor {
	readonly mode: "paper" | "live" | "replay";
	buy(req: { mint: string; solAmount: bigint; maxSlippageBps: number }): Promise<Fill>;
	sell(req: { mint: string; pct: number; maxSlippageBps: number }): Promise<Fill>;
}
```

`PaperExecutor` (Milestone 1). Deliberately pessimistic:

1. Wait `PAPER_LATENCY_MS` (default 800).
2. Fetch fresh curve state from chain (no cache).
3. Compute tokens out with the SDK quote function that matches the curve (v3 math for standard curves, v2 math for
   cashback coins), using live `Global` and `FeeConfig`.
4. Subtract `PAPER_EXTRA_SLIPPAGE_BPS` (default 300) to stand in for competing buys in the same slot.
5. Charge network fee (5,000 lamports), priority fee (`PRIORITY_FEE_SOL`, default 0.0005), and token-account rent
   (0.00203928 SOL, not refunded).
6. Sells use `getSellSolAmountFromTokenAmount` (or the PumpSwap pool quote after migration) with the same latency,
   haircut, and fees.

`LiveExecutor` (Milestone 2). See Section 9.

### 4.5 Positions (`src/engine/trader/positions.ts`)

Exit rules, evaluated on every curve or pool update:

| Rule | Default |
|---|---|
| Take profit | +100% |
| Stop loss | -30% |
| Trailing stop | off (0) |
| Max hold | 30 min |
| Migration | keep holding, switch pricing to the PumpSwap pool |

If the newest price is older than `PRICE_STALE_SEC` (default 10), the position shows STALE and no automatic exit fires
on it. Manual SELL still works.

### 4.6 Risk guard (`src/engine/risk/guard.ts`)

Applies in every mode.

| Limit | Default |
|---|---|
| Buy size | 0.05 SOL |
| Max open positions | 3 |
| Daily realized loss cap | 0.15 SOL, then auto-snipe pauses until 00:00 local |
| Tilt guard | 3 consecutive losing closes pauses auto-snipe for 10 min; manual SNIPE during tilt needs a 1.5s hold |
| Auto-snipe | on in paper and replay, off in live until switched on |
| Kill switch | sells every position at market, pauses the engine |

### 4.7 Ledger (`src/engine/ledger/`)

Append-only JSONL, one file per mode: `data/ledger.paper.jsonl`, `data/ledger.live.jsonl`,
`data/ledger.replay.jsonl`.

```ts
type LedgerRecord =
	| { kind: "fill"; id: string; positionId: string; mode: Mode; mint: string; symbol: string;
	    side: "buy" | "sell"; solAmount: string; tokenAmount: string; feesSol: string; signature?: string; ts: number }
	| { kind: "close"; positionId: string; mode: Mode; pnlSol: string; pnlPct: number;
	    reason: "take_profit" | "stop_loss" | "trailing" | "manual" | "kill" | "max_hold"; ts: number };
```

Amounts are stored as decimal strings of lamports and raw token units. On start, the engine replays the ledger to
rebuild open positions and stats, then re-subscribes to their curves. A truncated last line is ignored and logged.

### 4.8 Bridge (`src/engine/bridge/`)

- Binds `127.0.0.1` only, port `PORT` (default 7777).
- Generates a random session token at startup and injects it into the served `index.html`. WebSocket upgrades must
  carry the token and an `Origin` of `http://127.0.0.1:<PORT>` or `http://localhost:<PORT>`. Other websites in the
  owner's browser cannot connect.
- Protocol version 1, schemas in `src/shared/protocol.ts` (zod), validated on both ends.

Engine to web events: `hello` (protocol version, mode, settings), `snapshot` (full state on connect), `launch`, `check`
(verdict and reasons), `price` (mint, price, market cap, timestamp), `order` (pending, filled, failed), `position`,
`close`, `stats`, `feed` (status), `risk` (pause state, tilt count, daily PnL), `log`.

Web to engine commands, each answered with `ack { id, ok, error? }`: `snipe`, `sell` (pct 50 or 100), `pin`, `unpin`,
`pause`, `resume`, `kill`, `setSettings` (validated partial), `arm` (Milestone 2).

### 4.9 Replay and recording (`src/engine/replay/`)

- `--record` writes launches and account updates of watched coins to `data/recordings/<timestamp>.jsonl`.
- `--replay <file>` swaps the feed and chain for a virtual-time player over a recording. The HUD badge reads REPLAY.
- `fixtures/demo-session.jsonl` is a synthetic session generated with the SDK's curve math (`newBondingCurve` plus
  simulated buys and sells). It is labeled SYNTHETIC DEMO in the HUD and exercises every character state and every
  combo tier. `npm run demo` runs it offline.

## 5. Shared logic (`src/shared/`)

Pure functions used by both engine and web, unit-tested:

- `combo.ts`: combo count is the number of consecutive winning closes, counted backwards from the latest close. A win
  is `pnlSol > 0` after all fees; anything else, including breakeven, is a loss. Separate per mode.
- `tilt.ts`: consecutive losing closes and the cooldown window.
- Session PnL is realized PnL since the engine started, plus unrealized PnL of open positions.
- `stats.ts`: win rate, average win, average loss, profit factor, expectancy per trade, best and worst trade,
  cumulative PnL series, PnL by hour of day, hold time per trade, exit reason counts, launches per hour, check pass rate,
  top rejection reasons.
- `progression.ts`: office upgrades from lifetime realized PnL per mode (Section 7.4).

## 6. Configuration

`.env` (gitignored; `.env.example` committed):

| Key | Default | Purpose |
|---|---|---|
| `RPC_URL` | public mainnet endpoint | Solana HTTP RPC |
| `RPC_WS_URL` | derived from `RPC_URL` | Solana websocket RPC |
| `MODE` | `paper` | `paper` or `live` |
| `KEYPAIR_PATH` | unset | Live only: path to a `solana-keygen` JSON keypair file |
| `PORT` | 7777 | Bridge and UI port |
| `RPC_MAX_RPS` | 5 | RPC budget |

Trading settings (Sections 4.3, 4.5, 4.6, and paper fill settings) live in `data/settings.json`, editable from the HUD
settings panel and validated by the same zod schema.

## 7. The game (web)

### 7.1 Stack

Vite, React 19 for the HUD (DOM overlay), Three.js 0.186.1 for the scene with a custom render loop (no
react-three-fiber). Fonts bundled locally from `@fontsource` (Press Start 2P for headings and numbers, VT323 for dense
data; both OFL-1.1) so replay works offline.

### 7.2 Rendering pipeline

1. Scene renders to a 320x180 `WebGLRenderTarget` with nearest filtering. Orthographic isometric camera.
2. Post pass: palette quantization to the active 16-color tier palette with 4x4 Bayer dithering, then integer upscale
   to the canvas.
3. CRT pass: scanlines, slight barrel curvature, vignette, and chromatic offset that grows with combo tier.
4. All geometry is procedural voxels (merged boxes). No external models or textures.
5. Desk monitors and the wall screen use canvas textures drawn from live state.
6. The render loop pauses when the tab is hidden.

### 7.3 Cast

Chibi voxel characters (head about the size of the body), animated by moving parts (bob, arm swing, head turn), no
skeletal rigs. Each one is bound to a real subsystem:

| Character | Look | Bound to | States |
|---|---|---|---|
| ZORP, alien scout | green, antenna, headset | Feed | idle scan; hop and point on each launch; antenna red when a launch fails checks; asleep with Zzz when the feed is down |
| VERA, analyst | businesswoman, bob haircut, glasses, clipboard | Rug check | flips clipboard while checking; green APPROVED or red REJECTED stamp with the first failing reason in a speech bubble |
| REX, trader | pinstripe suit, slicked hair, sunglasses | Executor | typing while an order is pending; thumbs up on fill; facepalm on failure |
| GLOOP, alien CFO | purple, three eyes, monocle, tie | Ledger | counts coins on a win; throws money at combo x3 and up; sweats on a loss |
| YOU, CEO | owner avatar in the corner office | Session PnL | happy, neutral, or stressed by session PnL; dances on the desk in FEVER |

### 7.4 Office progression

Upgrades unlock at lifetime realized PnL for the current mode and are never removed after losses. Paper and replay
offices carry a "SIMULATION" hologram tint so they cannot be mistaken for live results.

| Lifetime realized PnL | Unlock |
|---|---|
| +0.1 SOL | SUPER C neon sign |
| +0.5 SOL | plants and coffee machine |
| +1 SOL | second desk row and an intern alien |
| +2.5 SOL | trophy wall |
| +5 SOL | penthouse window with a space view |
| +10 SOL | gold vault door |

### 7.5 Combo ladder

| Combo | Palette | Effects |
|---|---|---|
| x0-x1 | Terminal: phosphor green accents | none |
| x2 | Ice: cyan | COMBO x2 banner, arpeggio |
| x3 | Neon: magenta | 2px (internal) screen shake, coin particles |
| x4 | Gold Rush: gold | bloom, cast dances |
| x5 and up | FEVER: palette cycles every 0.5s | confetti voxels, stronger shake, music 20% faster |
| Loss | Cold: desaturated blue for 20s | glass-crack sound, tilt meter +1 |

Palette changes stay at or below 2 per second, under the 3-flashes-per-second threshold in WCAG 2.3.1.
`prefers-reduced-motion` (and a settings toggle) disables shake, particles, and palette cycling; tier colors still
apply.

### 7.6 HUD layout

Desktop (1200px and wider):

- Top bar: mode badge (PAPER, LIVE, REPLAY, or SYNTHETIC DEMO), wallet SOL balance (live) or paper balance, session
  PnL, W/L, combo meter, tilt meter, feed and engine status.
- Left panel (300px), launch radar: real launches with age, market cap, check verdict and reasons, SNIPE and pin
  buttons.
- Right panel (320px), positions: entry, live PnL bar, price age, SELL 50% and SELL 100%.
- Bottom: hotbar of pinned coins on keys 1-6, and the event log.
- Center: the scene.

Tablet (768-1199px): panels become tabs over the scene. Phone (under 768px): scene takes the top 40% of the viewport,
HUD panels stack below.

Analytics terminal (Tab key, or click GLOOP's monitor): a full-screen CRT view drawn in the active palette with
cumulative PnL (line), per-trade PnL (bars), exit reasons (bars), launches per hour and check pass rate (bars), hold
time against PnL (scatter), and the experiment verdict for the active mode (Section 9.4).

### 7.7 Controls

Default keys, all rebindable in settings and stored in `localStorage`: `1`-`6` hotbar snipe, `Up`/`Down` move the
radar selection, `S` snipe the selected coin, `Tab` analytics, `M` mute, `P` pause/resume engine, `K` kill switch
(1.5s hold).

### 7.8 Audio

WebAudio-synthesized chiptune effects, no audio files: launch blip, approve ding, reject buzz, fill cha-ching, combo
arpeggio pitched up per tier, loss crack, FEVER loop. Muted by default.

## 8. Failure handling

| Failure | Engine behavior | What the owner sees |
|---|---|---|
| PumpPortal websocket drops | Backoff reconnect | ZORP asleep, FEED DOWN badge, reconnect countdown |
| PumpPortal message shape changes | Messages without a valid mint are dropped and counted; raw samples saved | Dropped-message counter in the log |
| RPC errors or rate limits | Retry with backoff inside the RPC budget; checks beyond budget marked UNCHECKED | UNCHECKED tags in the radar, RPC warning badge |
| Curve websocket drops | Polls every 2s until it recovers | Price age shown on each position |
| Price older than 10s | No automatic exits on that position | STALE tag; manual SELL available |
| Browser loses the bridge | Engine keeps running and trading | CRT static screen, auto-reconnect, snapshot on reconnect |
| Engine crash or restart | Ledger replay restores positions and stats; live mode disarms | Fresh snapshot; ARM required again in live |
| Corrupt last ledger line | Ignored and logged | Warning in the log |
| Coin migrates while held | Pricing switches to the PumpSwap pool | Position tag MIGRATED |

## 9. Milestone 2: live trading

### 9.1 Buy and sell flow

1. `fetchBuyState` / `fetchSellState` with the coin's token program (Token-2022 for `create_v2` coins).
2. Build instructions with the SDK: v3 builders for standard SOL curves, v2 for cashback coins, PumpSwap SDK for
   migrated coins.
3. Prepend compute budget instructions: unit limit from simulation times 1.2, unit price from `PRIORITY_FEE_SOL`.
4. Simulate the transaction (`simulateTransaction`, no signature check, fresh blockhash).
5. Validate before signing:
   - The simulation has no error.
   - Every invoked program is in the allowlist: Pump, PumpAMM, PumpFees, ComputeBudget, System, SPL Token, Token-2022,
     Associated Token Account.
   - Wallet SOL decrease is at most buy amount plus fees plus rent plus 1% (buys), or zero apart from fees (sells).
6. Sign with the keypair loaded from `KEYPAIR_PATH`, send, and confirm at `confirmed` with blockhash expiry.
7. On expiry, look up the signature status before doing anything else. Buys are never retried automatically; sells
   retry up to 3 times.
8. Fetch the confirmed transaction and record the real fill from pre and post balances.

### 9.2 Arming

Live trading requires all of: `MODE=live`, a readable `KEYPAIR_PATH`, and the owner typing `ARM <last 4 chars of
wallet address>` in the HUD for the current engine session. Restarting the engine disarms it.

### 9.3 Wallet budget

`MAX_WALLET_SOL` (default 1.0). If the wallet balance is higher, a persistent banner says the wallet does not look
like a dedicated burner.

### 9.4 Experiment label

Live trading is an experiment. Budget: the SOL the owner puts in the burner wallet. The analytics terminal shows
expectancy per trade with a 90% confidence interval over the active mode's closes (built in Milestone 1, so paper
results get the same verdict). After 50 closes, if the whole interval is below zero, it shows "Strategy is losing
money" in red.

### 9.5 First live trade

The owner performs it with a 0.01 SOL buy, following the README runbook. It cannot be tested against mainnet from the
build environment.

## 10. Testing

- Unit (vitest):
  - combo, tilt, stats, and progression;
  - every rug-check rule;
  - risk guard limits and pauses;
  - paper fill math on recorded curve fixtures, checked against direct SDK quote calls;
  - feed parser on valid, partial, and malformed messages;
  - protocol schema round-trips;
  - ledger replay including a truncated last line.
- Integration: engine started against a fake PumpPortal websocket server and a fake RPC (`Connection` test double
  serving fixture accounts). A launch flows through check, paper buy, price updates, take profit, ledger write, and
  bridge events.
- Web: Playwright with the preinstalled Chromium against `npm run demo`. Asserts that the canvas renders, the HUD
  updates, the palette changes at x2 and the cold palette appears after a loss. Screenshots at 1440x900 and 390x844.
- Milestone 2 adds validator tests on locally built transactions: an honest buy, an extra SOL transfer, an unknown
  program, and an oversized SOL decrease.

## 11. Acceptance criteria

Milestone 1 is done when:

1. `npm install && npm start` in `apps/solana-tycoon/` starts the engine and serves the UI at `http://127.0.0.1:7777`
   with only `RPC_URL` set (public RPC fallback works without it).
2. With network access, real launches appear in the radar within seconds of PumpPortal delivering them; checks show
   reasons; paper auto-snipe opens positions; prices update from chain; exits close positions; the ledger, stats, and
   combos update.
3. `npm run demo` runs fully offline and reaches every character state and every combo tier.
4. Unit, integration, and Playwright tests pass. The app's lint and type check pass with no warnings.
5. No placeholders, TODOs, or randomized data in the product code paths.
6. The README covers setup, every config key, failure modes, and what to do for each.

Milestone 2 is done when Section 9 is implemented, its validator tests pass, and the README runbook for the first
0.01 SOL trade exists.

## 12. Security

- Private keys only ever come from `KEYPAIR_PATH`, never from code, `.env` values, or the browser.
- `.env`, `data/`, and keypair files are gitignored.
- The bridge binds to loopback and requires the session token and an allowed Origin.
- Settings from the browser are schema-validated and clamped to hard maxima: buy size at most 1 SOL, at most 10
  positions.
- The live executor signs only transactions that pass simulation and validation (Section 9.1).

## 13. Licensing

Runtime dependencies: pump SDK (MIT), three (MIT), React (MIT), zod (MIT), Solana web3.js (MIT). Fonts: OFL-1.1. All
visuals and audio are generated in code. Licenses are re-checked when the plan pins versions.

## 14. Risks

| Risk | Mitigation |
|---|---|
| pump SDK churn: majors 2.0 to 4.1 within 30 days | Exact pin; upgrades are deliberate, with tests re-run |
| PumpPortal schema or pricing changes again | Defensive parser, raw sample capture, feed status visible |
| Free RPC limits | Token bucket, UNCHECKED marking, `RPC_URL` to swap providers |
| No mainnet access while building | Recorded and synthetic replays; first live run on the owner's machine with paper mode |
| Memecoin trading losses | Paper first, caps, tilt guard, kill switch, experiment verdict |
| Localhost bridge reachable by other sites | Session token and Origin check |

## 15. Parking list

- Fallback launch discovery from on-chain logs (`logsSubscribe` on the Pump program, decoding `CreateEvent`) if
  PumpPortal becomes unavailable.
- Analytics of the wallet's manual trades.
- Kraken desk for `crypto_bot.py`.
- Productizing (hosted, multi-user, fee mechanism).
- Staffing and scheduling intake checklist (separate client project).
