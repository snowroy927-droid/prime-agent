# SUPER C SNIPER

A personal pump.fun command center for Solana. A local engine watches new pump.fun launches, checks each coin on-chain
against rug rules, and paper-trades the ones that pass at real prices. A browser dashboard shows it all as a pixel-art
3D trading floor: a chibi crew reacts to every trade, and winning streaks change the whole screen's colours.

Every number on screen comes from the launch feed, on-chain account state, or the engine's ledger of closed trades.
Nothing is randomized. The only simulated data is the offline demo, which is labelled SYNTHETIC DEMO everywhere it
appears.

## Status

- **Milestone 1 (this version): paper trading at real prices.** Includes the offline demo, replaying a recorded
  session, and recording a live session. No wallet and no signing.
- **Milestone 2 (not built yet): live trading.** A dedicated burner wallet, buy and wallet caps, an arming step, and a
  runbook for the first 0.01 SOL trade. Until then `MODE=live` exits with a message.
- **Not yet run against mainnet.** The build machine cannot reach PumpPortal or Solana RPC. Expect the first
  real-network run, in paper mode on your machine, to surface feed or RPC details the demo cannot. The table under
  [When something goes wrong](#when-something-goes-wrong) says what to do.

## Requirements

- Node.js 22.12 or newer, with npm.
- Recommended: an HTTPS RPC endpoint from a Solana RPC provider; free tiers exist. Without one, the engine uses the
  public `api.mainnet-beta.solana.com`, which is rate-limited per IP and not meant for steady use.

## Setup

```bash
cd apps/solana-tycoon
npm install
cp .env.example .env
```

Open `.env` and set `RPC_URL` to your provider's HTTPS endpoint. Everything else has a working default.

## Run

| Command | What it does |
|---|---|
| `npm start` | Builds the dashboard, starts the paper engine, and prints the URL (default `http://127.0.0.1:7777`) |
| `npm run demo` | Plays the synthetic demo session offline; no network needed |
| `npm run demo -- --speed 4` | The same demo, 4 times faster |
| `npm start -- --record` | Paper trading that also records the session to `data/recordings/<timestamp>.jsonl` |
| `npm run replay -- data/recordings/<file>.jsonl` | Replays a recorded session through the engine; the badge reads REPLAY |

Open the printed URL in a browser. Stop the engine with `Ctrl+C`. Open paper positions are restored from the ledger
the next time it starts.

Flags (pass them after `--`):

| Flag | Meaning |
|---|---|
| `--demo` | Run the synthetic demo session (`fixtures/demo-session.jsonl`) |
| `--replay <file>` | Replay a recording made with `--record` |
| `--record` | Record launches and watched coins' account updates while paper trading |
| `--speed <n>` | Demo and replay only. Fast-forwards the whole engine, including check delays, fill latency, holds, and cooldowns, so results match normal speed. The page follows the engine's clock. |
| `--port <n>` | Overrides `PORT`; `0` picks a free port |
| `--data-dir <dir>` | Where ledgers, settings, and recordings live (default `data/`) |
| `--static-dir <dir>` | Where the built dashboard is served from (default `dist/web/`) |

`npm run make-demo` regenerates `fixtures/demo-session.jsonl`. It is deterministic, so the output only changes if
the generator changes.

## Using the dashboard

- **Launch radar (left).** New launches, newest first. Each shows its verdict (APPROVED, REJECTED, PENDING,
  UNCHECKED) and the first failing reason. SNIPE buys at your buy size. A rejected coin, or any coin during a tilt
  cooldown, needs HOLD SNIPE: hold the button for 1.5 s. PIN puts a coin on the hotbar.
- **Trading desk (right).** Open positions with entry, current price, PnL and price age, SELL 50% / SELL 100%, quick
  stats, and office upgrades.
- **Hotbar.** Six pinned coins; keys `1` to `6` snipe them.
- **Top bar.** Balance, session PnL, wins/losses, combo, tilt, feed, RPC, and engine state. Also the AUTO, PAUSE,
  MUTED, ANALYTICS, SETTINGS, and KILL buttons. KILL sells every position and pauses the engine; hold it for 1.5 s.
- **Combo tiers.** The screen palette follows your streak of winning closes: 2 wins ICE, 3 NEON, 4 GOLD, 5 or more
  FEVER. Any losing close turns it COLD for 20 seconds. A win is PnL above zero after all fees; breakeven counts as a
  loss.
- **Office upgrades.** Unlocked by your best-ever cumulative realized PnL in the current mode: neon sign 0.1 SOL,
  plants and coffee 0.5, second desk row 1, trophy wall 2.5, space window 5, gold vault 10.
- **Analytics terminal.** Open it with the ANALYTICS button, by clicking GLOOP or GLOOP's monitor in the office, or
  with `Tab` while no control has focus. `Escape` closes it. It shows:
  - realized PnL, expectancy per trade with its 90% confidence interval, win rate, profit factor, best and worst
    trade, and check pass rate;
  - charts of cumulative PnL, PnL per trade, exit reasons, launches per hour, top rejection reasons, and hold time
    against PnL;
  - a table of every closed trade.

  Hover or use the arrow keys on a chart to read values.
- **The verdict.** The terminal's verdict waits for 50 closed trades in the current mode. After that it reads
  "Strategy is losing money" when the 90% interval for expectancy lies entirely below zero. Otherwise it reads
  "No evidence of losing money (90% CI)". It is a check on the past, not a forecast.

Default keys. Rebind them in SETTINGS; bindings are stored in this browser.

| Key | Action |
|---|---|
| `1` to `6` | Snipe hotbar coin |
| `Up` / `Down` | Move the radar selection |
| `S` | Snipe the selected coin |
| `Tab` | Analytics terminal |
| `M` | Mute / unmute (sound starts muted) |
| `P` | Pause / resume the engine |
| `K` | Kill switch (hold 1.5 s) |

## Configuration (`.env`)

| Key | Default | Purpose |
|---|---|---|
| `RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana HTTP RPC. Set your provider's URL; the RPC chip reads PUBLIC while the default is in use. |
| `RPC_WS_URL` | Derived from `RPC_URL` (`https` becomes `wss`) | Solana websocket RPC, used for price updates |
| `MODE` | `paper` | `paper` or `live`. Live arrives in Milestone 2 and exits for now. |
| `KEYPAIR_PATH` | unset | Live only (Milestone 2): path to a `solana-keygen` JSON keypair of a dedicated burner wallet |
| `PORT` | `7777` | Port for the dashboard and engine on 127.0.0.1 |
| `RPC_MAX_RPS` | `5` | Most RPC requests per second the engine may spend. Raise it only as far as your provider's plan allows. |

## Trading settings

Settings are stored per mode in `data/settings-<mode>.json`, for example `data/settings-paper.json`. Edit them in the
SETTINGS panel. Every change is validated, and buy size is capped at 1 SOL and open positions at 10 whatever the file
says.

| Setting | Default | Effect |
|---|---|---|
| `buySol` | 0.05 | SOL spent per buy |
| `maxPositions` | 3 | Most positions open at once |
| `takeProfitPct` | 100 | Sell everything at +100% |
| `stopLossPct` | 30 | Sell everything at -30% |
| `trailingStopPct` | 0 | Sell when PnL falls this many points below its peak; 0 turns it off |
| `maxHoldMin` | 30 | Sell after this many minutes regardless of PnL |
| `dailyLossCapSol` | 0.15 | Once the day's realized loss reaches this, auto-snipe stops until local midnight |
| `tiltLosses` | 3 | This many losing closes in a row starts a tilt cooldown |
| `tiltCooldownMin` | 10 | Tilt cooldown length; manual snipes need a hold during it |
| `autoSnipe` | true | Buy approved coins automatically |
| `snipeDelaySec` | 2 | Seconds after a launch before it is checked |
| `recheckDelaysSec` | 10, 30 | Seconds after launch to re-check coins that failed only soft rules |
| `priceStaleSec` | 10 | Price age after which a position is STALE and automatic exits stop |
| `rug.blocklist` | test, rug, scam, fake, honeypot | Reject names or symbols containing these words |
| `rug.serialLaunchMax` | 3 | Reject a creator with this many launches or more inside the window |
| `rug.serialWindowMin` | 60 | Window for the serial-launcher rule, in minutes |
| `rug.maxTopHolderPct` | 20 | Reject if the largest holder, not counting the bonding curve, holds more than this percent of supply |
| `rug.minHoldersInTop20` | 10 | Reject if fewer of the top 20 token accounts hold a balance |
| `rug.minRealSol` | 1.0 | Reject if fewer than this many real SOL are in the curve |
| `paper.startingBalanceSol` | 1.0 | Paper balance before any trades |
| `paper.latencyMs` | 800 | Simulated delay before a paper fill is priced |
| `paper.extraSlippageBps` | 300 | Haircut on every paper fill, on top of the curve's own price impact |
| `paper.priorityFeeSol` | 0.0005 | Priority fee charged per paper transaction |

The rug rules a coin always has to pass are SOL quote, not mayhem mode, curve still live, name blocklist, and serial
launcher. Failing only the holder or curve-size rules is a soft rejection that is checked again at
`recheckDelaysSec`.

## Paper and live

- **Paper (now).** Each fill is priced against the coin's current bonding curve, or its PumpSwap pool after
  migration, using the pump.fun SDK's own quote and fee math. The engine waits `paper.latencyMs` first. Every fill also
  takes the extra slippage haircut and pays the network base fee and the priority fee; buys also pay 0.00203928 SOL of
  token account rent. Nothing is signed and no wallet is needed.
- **Live (Milestone 2).** Live signing will use a dedicated burner wallet from `KEYPAIR_PATH`, with buy and wallet
  caps, an explicit arming step, and only transactions that pass simulation and validation.

## When something goes wrong

| Failure | What the engine does | What you see | What to do |
|---|---|---|---|
| PumpPortal websocket drops | Reconnects with backoff | ZORP asleep, FEED DOWN with a reconnect countdown | Nothing at first. If it stays down for minutes, check your internet connection and PumpPortal's status. |
| PumpPortal changes its message format | Drops messages without a valid mint and counts them; saves the first 50 raw messages of each run | "Feed: N messages dropped" in the event log | Keep `data/fixtures/pumpportal-raw-*.jsonl` and update the parser in `src/engine/feed/parse.ts` to the new shape. |
| RPC errors or rate limits | Retries with backoff inside `RPC_MAX_RPS`; checks that cannot fit the budget are marked UNCHECKED | UNCHECKED tags in the radar; RPC chip DEGRADED or PUBLIC | Set `RPC_URL` to a dedicated provider. Raise `RPC_MAX_RPS` only if your plan allows it. |
| Curve websocket drops | Keeps pricing from a 2 s poll that runs alongside the websocket | Price age on each position | Nothing. If prices stay old, check `RPC_WS_URL` and the RPC chip. |
| Price older than `priceStaleSec` | Stops automatic exits on that position | STALE tag; SELL buttons still work | Sell manually if you need to; check the RPC chip. |
| Browser loses the engine | The engine keeps running and trading | ENGINE OFFLINE screen with a reconnect countdown | Wait or reload. If the engine process stopped, start it again. |
| Engine crash or restart | Rebuilds positions and stats from the ledger | A fresh snapshot after reconnect | Run `npm start` again. |
| Partial last ledger line (power loss mid-write) | Skips that line and logs it | A warning in the log | Nothing. The partial line was never a complete trade. |
| Coin migrates while held | Prices it from the PumpSwap pool | MIGRATED tag on the position | Nothing. Exits keep working. |
| WebGL unavailable | The office is not drawn | A message in the office area; the HUD keeps working | Turn on hardware acceleration in the browser. |
| Port already in use | Exits with `listen EADDRINUSE: address already in use 127.0.0.1:<port>` | The engine does not start | Stop the other instance, or set `PORT` or pass `--port`. |
| Engine and page versions differ | The page logs a protocol mismatch | An error in the event log | Restart the engine and reload the page. |

## Where data lives

Everything the engine writes goes under `data/`, which git ignores:

| Path | Contents |
|---|---|
| `data/ledger-paper.jsonl` | Every paper fill and close. Balance, stats, combos, and upgrades are all computed from it. |
| `data/settings-paper.json` | Paper trading settings |
| `data/launches.jsonl` | Launches from the last 24 hours, for the serial-launcher rule |
| `data/recordings/` | Sessions recorded with `--record` |
| `data/fixtures/` | The first 50 raw feed messages of each run |
| `data/ledger-demo.jsonl`, `data/ledger-replay.jsonl` | Demo and replay trades; emptied each time a demo or replay starts |

To reset paper results, stop the engine, delete `data/ledger-paper.jsonl`, and start it again. The balance returns
to `paper.startingBalanceSol`. Delete `data/settings-paper.json` as well to restore the default settings.

## Security

- The engine listens on 127.0.0.1 only. The dashboard gets a random session token per run, and the engine rejects
  connections without it or from other origins. The page ships a strict Content Security Policy.
- Milestone 1 holds no private key. In Milestone 2 the key will come only from the file at `KEYPAIR_PATH`, for a
  dedicated burner wallet holding only what you are willing to lose.
- Never paste a private key or seed phrase into the browser, `.env` values, code, or a chat.
- `.env`, `data/`, and `*.keypair.json` are git-ignored.
- Settings sent from the browser are schema-validated and clamped: at most 1 SOL per buy and 10 open positions.

## Tests

From `apps/solana-tycoon/`:

```bash
npx vitest run       # unit and integration tests
npm run check        # Biome lint and format, then TypeScript
npm run test:e2e     # builds, starts the demo at 4x on port 7788, and drives Chromium
```

The end-to-end tests need a Chromium for Playwright. Run `npx playwright install chromium` once, or point
`PW_CHROMIUM_PATH` at an existing Chromium binary. Screenshots at 1440x900 and 390x844 are written to
`test-results/screenshots/`.

## Licenses

Checked 2026-10-15 over all 253 installed packages (`npm ls --all --json --long`, reading each package's declared
license). Fonts are OFL-1.1. Everything else is MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, or 0BSD, except:

| Package | License | Pulled in by | Notes |
|---|---|---|---|
| `rpc-websockets` 9.3.9 | LGPL-3.0-only | `@solana/web3.js` | Used unmodified as a library. If you ever distribute the app, keep its source and license with it (they are in `node_modules`) and leave it replaceable. |
| `lightningcss` 1.33.0 | MPL-2.0 | `vite` | Build-time only; not part of the served dashboard. |
| `pako` 2.2.0 | MIT AND Zlib | `@coral-xyz/anchor` | Permissive |
| `fastestsmallesttextencoderdecoder` 1.0.22 | CC0-1.0 | `@solana/spl-token` | Public-domain dedication |
| `text-encoding-utf-8` 1.0.2 | Unlicense (no `license` field; see its LICENSE.md) | `@solana/web3.js` | Public domain |
| `eyes` 0.1.8 | MIT (no `license` field; see its LICENSE) | `@solana/web3.js` | Permissive |

`npm ls` reports two peer-range warnings that do not affect the app:

- `typescript` 7.0.2 is outside `@solana/codecs` 2.0.0-rc.1's `^5.0.0` peer range. It is type-checking only, and
  `npm run check` passes.
- `utf-8-validate` 6.0.6 is outside the optional `^5.0.2` peer range of the `ws` 7 copy used by `jayson`. That `ws`
  accepts version 6's function export.
