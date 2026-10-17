# SUPER C SNIPER: Kraken Desk - Design Spec

Date: 2026-10-15
Status: Approved in conversation, section by section. Awaiting the owner's review of this written spec.
Location: `apps/solana-tycoon/`. Builds on `2026-10-15-super-c-sniper-design.md` (Milestone 1).

## 1. Intent

Add a second desk to the command center for Kraken altcoins and meme coins. It scans every Kraken USD pair for movers,
paper-trades a fixed momentum rule at real Kraken prices, accepts manual buys, and reports its results beside the
pump.fun desk in one analytics terminal.

### Decisions made with the owner

| Topic | Decision |
|---|---|
| Mode | Paper on real Kraken prices first. Live trading with the owner's API keys is a later phase. |
| Coins | All movers across Kraken's USD spot pairs |
| Picks | A fixed momentum rule auto-buys on paper; the owner can also buy by hand |
| Analytics | One terminal with PUMP.FUN, KRAKEN, and COMBINED tabs |
| Architecture | A second desk inside the existing engine process: one dashboard, one port |
| Keys | Not read, stored, or needed in this phase |

### Money mechanism

The desk measures, with no money at risk, whether a momentum rule on Kraken movers beats its round-trip costs (about
1.9% at the default fee and slippage). The verdict after 50 closes decides whether a live phase is worth building. A
live phase would run against a fixed experiment budget with caps, like pump.fun Milestone 2.

### Non-goals

- Placing real Kraken orders, reading the owner's Kraken balances or trade history, or handling API keys.
- Pairs quoted in anything but USD; margin, futures, staking, or short selling.
- Changing how the pump.fun desk trades.

## 2. Verified facts this design depends on

Checked 2026-10-15 through web search. The build container cannot open docs.kraken.com or reach api.kraken.com
(`curl` failed to connect, 2026-10-15). Unverified items are handled defensively.

| Fact | Source | Status |
|---|---|---|
| WebSocket v2 endpoint is `wss://ws.kraken.com/v2`. The `ticker` channel takes a symbol list, sends level-1 data (best bid/ask, last trade), and updates on trades. | [Kraken WebSocket v2 docs](https://docs.kraken.com/api/docs/websocket-v2/) | Verified (secondhand) |
| The v2 `ohlc` channel takes `symbol` and `interval` in minutes (1, 5, 15, 30, 60, 240, 1440, 10080, 21600). It updates on trades, so a 1-minute candle can change several times within its minute. It acknowledges each symbol. | [Kraken WebSocket v2 OHLC](https://docs.kraken.com/api/docs/websocket-v2/ohlc) | Verified (secondhand) |
| Exact v2 field names in ticker and ohlc messages | Not retrieved | Unverified. The parser accepts unknown shapes and saves raw samples. |
| REST OHLC returns up to 720 candles. Public endpoints are rate-limited per IP; Kraken recommends about 1 s between OHLC calls. | [Kraken historical data guide](https://docs.kraken.com/exchange/guides/general/historical-data) | Verified (secondhand) |
| Exact public REST limits (third parties report about 1 request/s sustained per IP, short bursts tolerated) | [apis.io Kraken rate limits](https://apis.io/rate-limits/kraken/kraken-rate-limits/) | Unverified. The client spends at most 1 request/s and backs off on HTTP 429. |
| AssetPairs returns `altname`, `base`, `quote`, `pair_decimals`, `lot_decimals` per pair | Community wrappers ([go-kraken](https://pkg.go.dev/github.com/hmedkouri/go-kraken), [krakex](https://hexdocs.pm/krakex/Krakex.html)) | Verified (secondhand) |
| AssetPairs also returns `wsname`, `ordermin`, `costmin`, and a trading `status` | Not retrieved | Unverified. All four are optional in the parser. A missing `status` means tradeable. A missing `wsname` is derived from `altname`. |
| Spot fees range from a -0.02% maker rebate to a 0.80% taker charge, by 30-day volume. Page updated 2026-10-01. | [Kraken fee schedule](https://support.kraken.com/articles/201893638-fee-schedule) | Verified |
| Base tier after a July 2026 change is 0.40% maker / 0.80% taker | [BrokerChooser comparison](https://brokerchooser.com/news/coinbase-vs-kraken-fee-structures-and-trading-features-compared--bbeea493) | Verified (third-party) |
| API keys are created under Settings → API with per-key permissions. Trading needs Query Funds and Create & Modify Orders; Withdraw Funds is separate. IP restriction is recommended. | [Kraken API keys guide](https://docs.kraken.com/exchange/guides/rest/api-keys), [Kraken support](https://support.kraken.com/articles/360000919966-api-key-permissions) | Verified. Applies to the later live phase only. |

## 3. Architecture

The engine process gains a Kraken desk that runs beside the existing pump.fun `TradingCore`. Both desks publish on
the same bus and bridge. They share nothing that moves money: each has its own ledger, balance, settings, risk guard,
and combo.

```
apps/solana-tycoon/src/engine/kraken/
  rest.ts        public REST client: AssetPairs, Ticker, OHLC; 1 request/s budget, 429 backoff
  pairs.ts       USD pair universe: parse and filter AssetPairs, precision, hourly refresh
  feed.ts        WebSocket v2 client: ticker + ohlc(1) for every pair, in batches; defensive parse; raw capture
  bars.ts        per-pair rolling 60 one-minute bars (close, volume), seeded from REST OHLC
  scanner.ts     ranks movers and applies the volume and spread filters
  rule.ts        the momentum entry rule (pure)
  money.ts       micro-USD and lot arithmetic (pure)
  paper.ts       Kraken paper executor
  ledger.ts      Kraken fill/close records on the shared append-only ledger mechanics
  desk.ts        KrakenDesk: positions, exits, risk, commands, events
  synthetic.ts   seeded SYNTHETIC Kraken session for the demo
apps/solana-tycoon/src/shared/
  kraken.ts      Kraken domain types and the settings schema
```

`main.ts` builds the Kraken desk in paper, demo, and replay modes unless `KRAKEN=off`. Demo and replay drive it from
a recording on the same `ScaledClock` as the pump.fun desk.

## 4. Market data

- **Universe.** USD-quoted spot pairs from AssetPairs, refreshed hourly. Excluded:
  - pairs whose `status` is present and is not `online`;
  - pairs whose base is in `excludeBases` (stablecoins and fiat by default, see Section 12).
  A pair that disappears or goes non-online while held is marked HALTED (Section 13).
- **Live data.** One WebSocket connection subscribes to `ticker` (for bid, ask, last) and `ohlc` with interval 1 (for
  per-minute close and volume; a bar's USD volume is its base volume times its close). Each subscribe message carries 50 symbols. The per-message symbol limit is unverified
  and 50 keeps well under any likely limit. Reconnects back off from 1 s up to 30 s. The first 50 raw messages of each
  run are saved to `data/fixtures/kraken-raw-<timestamp>.jsonl`.
- **Bars.** Each pair keeps its last 60 one-minute bars, built from the `ohlc` stream; a bar's last update for its
  minute wins. At startup and when a pair first passes the volume filter, its last 60 minutes are seeded from REST
  OHLC. Seeding is spaced at most 1 request/s, so it can take a few minutes for many pairs. A pair the rule considers
  needs 15 full minutes of bars, seeded or live.
- **24h volume in USD** is the ticker's 24h base volume times its VWAP. If VWAP is missing, the last price is used.

## 5. Scanner and momentum rule

Every 5 s (engine clock) the scanner ranks pairs that pass the filters by their 15-minute % change. The top 50 go to
the KRAKEN radar with:
- their 5, 15, and 60-minute change;
- 24h USD volume and spread;
- a rule status: `ELIGIBLE`, or the first reason the rule skips the pair.

| Step | Condition (default) |
|---|---|
| Volume filter | 24h volume ≥ `minVolumeUsd24h` ($250,000) |
| Spread filter | (ask − bid) / mid ≤ `maxSpreadPct` (0.6%) |
| Move | 15-minute change ≥ `minChange15mPct` (+4%) |
| Still rising | 5-minute change > 0 when `requireRising5m` is on |
| Volume surge | Last-15-minute USD volume ≥ `volumeSurge` (2) × (last-60-minute USD volume / 4) |
| Not held | No open or pending position on the pair |
| Re-entry cooldown | No exit on the pair in the last `reentryCooldownMin` (60) minutes |
| Risk guard | Not paused, under `maxPositions`, no tilt cooldown, daily cap not hit (Section 7) |

When `autoBuy` is on, an `ELIGIBLE` pair is paper-bought once per scan cycle, in rank order, until a limit stops it.
Each skip is counted by reason for the analytics (Section 11).

**Exits**, checked on every ticker update and every 1 s tick:
- take profit at `takeProfitPct` (+6%);
- stop loss at `stopLossPct` (−3%);
- trailing stop: exit when PnL % falls `trailingStopPct` (2) points below its peak, once the peak has passed
  `trailingArmPct` (2);
- max hold `maxHoldMin` (120).

PnL % uses the position's sell value: what a sell at the current bid would return after haircut and fee. A price older
than `priceStaleSec` (10 s) stops automatic exits for that position; manual SELL still works.

## 6. Paper fills and money

- **Cash** is integer micro-USD (bigint). **Quantity** is integer lots scaled by the pair's `lot_decimals`. **Price**
  is parsed from decimal text into an integer scaled by `pair_decimals`. Floats are used only for display.
- **Buy:**
  - The fill waits `latencyMs` (300) and uses the ask at that moment.
  - `askEff = ask × (1 + extraSlippageBps / 10,000)`.
  - `qty = floor(buyUsd / askEff)` at lot precision.
  - `fee = ceil(qty × askEff × takerFeePct / 100)`.
  - `cost = qty × askEff + fee`.
  - The buy fails visibly if `qty` is below `ordermin` or the notional is below `costmin` (when Kraken provides them),
    or if `cost` exceeds the paper balance.
- **Sell** works the same way at the bid: `bidEff = bid × (1 − slip)`, `proceeds = qty × bidEff − fee`. SELL 50% sells
  half the lots, rounded down to lot precision.
- **Defaults:** taker fee 0.80% per fill and slippage 0.15% per fill (15 bps). The round trip costs about 1.9%.
- **Balance** starts at `startingBalanceUsd` ($1,000). Open position cost and pending buys are reserved.

## 7. Risk and controls

- The Kraken desk has its own `RiskGuard` instance with its own settings: pause, tilt (`tiltLosses` 3, cooldown 30 min),
  and daily loss cap ($60).
- **Pause, resume, and AUTO** act on the desk on screen.
- **KILL acts on both desks.** It sells every position on each desk, pauses both, and keeps selling late fills on both
  until RESUME. This is the Milestone 1 kill-switch behaviour.
- **Hard caps:** `buyUsd` ≤ $1,000 and `maxPositions` ≤ 10. Pins: up to 6 pairs per desk.

## 8. Ledger and data files

| Path | Contents |
|---|---|
| `data/ledger-kraken-<mode>.jsonl` | Kraken fills and closes: same append-only, skip-malformed-lines behaviour as the pump.fun ledger. Records use `usdMicros` and `lots` fields and carry `pair`. |
| `data/settings-kraken-<mode>.json` | Kraken settings for the mode |
| `data/fixtures/kraken-raw-*.jsonl` | First 50 raw Kraken WebSocket messages of each run |
| `data/recordings/*.jsonl` | `--record` now also records Kraken REST responses and WebSocket messages, so replays play both desks |

Demo and replay empty their Kraken ledger at start, like the pump.fun ledger.

## 9. Protocol

`PROTOCOL_VERSION` becomes 2. The engine serves its own page, so page and engine always match; the hello message
already reports a mismatch.

- The pump.fun snapshot fields and events are unchanged.
- The snapshot gains `kraken: KrakenSnapshot | null`, which is `null` when the desk is off. It carries:
  - `feed`, `movers` (top 50), `positions`, `closes` (newest 500), `stats`, `scanStats`, `risk`, `settings`, `pinned`,
    and `balanceUsdMicros`;
  - `solUsd: { price, at } | null`, from the SOL/USD ticker, for the COMBINED tab.
- New events:
  - `kraken_movers` (each scan);
  - `kraken_price` (held and pinned pairs only, throttled to 4 per second per pair);
  - `kraken_order`, `kraken_position`, `kraken_close`;
  - `kraken_stats` (with `scanStats`);
  - `kraken_feed`, `kraken_risk`, `kraken_balance`, `kraken_settings`, `kraken_pinned`, `kraken_sol_usd`.
- Log lines stay on the shared `log` event, prefixed `Kraken:`.
- New commands:
  - `kraken_buy` {pair, holdConfirmed?}, `kraken_sell` {pair, pct 50|100};
  - `kraken_pin` / `kraken_unpin` {pair};
  - `kraken_pause`, `kraken_resume`, `kraken_setSettings` {patch}.
  - `kill` stays one command and acts on both desks.
- Every new message is zod-validated like the existing ones.

## 10. Game and HUD

- **Desk switch.** A PUMP / KRAKEN toggle in the top bar, plus a rebindable `switchDesk` action (default `D`) in
  `DEFAULT_KEYBINDINGS` (`src/web/hud/keybindings.ts`). The radar, trading desk, hotbar, top-bar chips (balance in SOL or USD, W/L, combo, tilt,
  feed), and settings panel follow the selected desk. The choice is remembered in the browser.
- **Combo and screen tier** follow the selected desk's own streak, with the Milestone 1 tier rules.
- **KRAKEN radar rows** show:
  - the pair, its 5, 15, and 60-minute change, 24h volume, and spread;
  - the rule status;
  - BUY (needs a hold during tilt or for a pair the rule skipped) and PIN.
- **INKY**, a squid-alien Kraken trader, works at a new desk in the office. INKY:
  - reacts to Kraken fills, wins, and losses the way REX does for pump.fun;
  - sleeps when the Kraken feed is down;
  - has a wall ticker of the top 5 movers;
  - has a trophy shelf that unlocks at $50, $250, and $1,000 of peak realized USD in the mode.
  The existing office upgrades stay tied to pump.fun SOL.
- **Sound.** A distinct chime for Kraken fills, built with the existing WebAudio synth.

## 11. Analytics terminal

- **PUMP.FUN tab:** the Milestone 1 terminal, unchanged.
- **KRAKEN tab:** the same tiles, charts, table, and verdict, in USD, plus:
  - "movers per hour": distinct pairs that met the move condition, per hour, last 24 hours;
  - "top skip reasons": why eligible movers were not bought, as counts by reason.
- **COMBINED tab:**
  - total realized PnL in USD, with SOL converted at `solUsd` (the rate and its time are shown);
  - one cumulative PnL chart with both desks, direct-labelled;
  - both verdicts side by side. There is no blended verdict, because the desks run different strategies.
  - Without a SOL/USD price, the tab shows pump.fun in SOL with that note.
- `computeStats` gains a minor-units-per-whole parameter (1e9 for lamports, 1e6 for micro-USD) so both desks share it.

## 12. Settings and configuration

`.env` gains `KRAKEN` (`on` by default; `off` disables the desk). No Kraken key variables exist in this phase.

Kraken settings, editable in the SETTINGS panel while the KRAKEN desk is selected:

| Setting | Default | Effect |
|---|---|---|
| `buyUsd` | 50 | USD per buy |
| `maxPositions` | 5 | Most open positions |
| `takeProfitPct` | 6 | Sell everything at +6% |
| `stopLossPct` | 3 | Sell everything at −3% |
| `trailingStopPct` | 2 | Exit this many points below peak PnL % |
| `trailingArmPct` | 2 | Peak PnL % that arms the trailing stop |
| `maxHoldMin` | 120 | Sell after this many minutes |
| `dailyLossCapUsd` | 60 | Stop auto-buys until local midnight once the day's realized loss reaches this |
| `tiltLosses` | 3 | Losing closes in a row that start a tilt cooldown |
| `tiltCooldownMin` | 30 | Tilt cooldown length |
| `autoBuy` | true | Buy eligible movers automatically |
| `priceStaleSec` | 10 | Price age that stops automatic exits |
| `scan.minVolumeUsd24h` | 250000 | Volume filter |
| `scan.maxSpreadPct` | 0.6 | Spread filter |
| `scan.excludeBases` | USDT, USDC, DAI, PYUSD, USDG, TUSD, EURC, EUR, GBP, CAD, AUD, CHF, JPY | Bases never scanned |
| `rule.minChange15mPct` | 4 | Move condition |
| `rule.requireRising5m` | true | Still-rising condition |
| `rule.volumeSurge` | 2 | Volume surge multiple |
| `rule.reentryCooldownMin` | 60 | Re-entry cooldown per pair |
| `paper.startingBalanceUsd` | 1000 | Paper balance before any trades |
| `paper.takerFeePct` | 0.80 | Fee per fill. Set it to your account's tier. |
| `paper.extraSlippageBps` | 15 | Haircut per fill |
| `paper.latencyMs` | 300 | Delay before a paper fill is priced |

## 13. Failure handling

| Failure | Engine behavior | What the owner sees |
|---|---|---|
| Kraken WebSocket drops | Reconnects with backoff (1 s up to 30 s) and resubscribes | KRAKEN FEED DOWN with a countdown; INKY asleep |
| Ticker or ohlc message shape changes | Drops messages it cannot read, counts them, saves raw samples | "Kraken: N messages dropped" in the log at 1, 10, 100, ... |
| REST errors or HTTP 429 | Backs off and retries within the 1 request/s budget; unseeded pairs wait for live bars | Pairs show WARMING UP until they have 15 minutes of bars |
| Price older than `priceStaleSec` | No automatic exits on that position | STALE tag; manual SELL available |
| Held pair goes non-online or leaves AssetPairs | No automatic exits; manual SELL tries at the last bid | HALTED tag |
| No SOL/USD price | COMBINED tab falls back | pump.fun shown in SOL with a note |
| Engine restart | Kraken positions and stats rebuild from the Kraken ledger | Fresh snapshot |
| Kraken desk throws on startup | The pump.fun desk still starts; the error is logged | Kraken desk shows OFFLINE with the error |

## 14. Testing

- **Unit tests:**
  - `money` (rounding direction at every step, lot precision, minimum checks);
  - `pairs` (filters, missing optional fields);
  - `feed` parse (known shapes, unknown shapes, raw capture);
  - `bars` (seeding, in-minute updates);
  - `scanner` and `rule` (each condition at its boundary);
  - `paper`;
  - desk exits (TP, SL, trailing arm and exit, max hold, stale, halted);
  - risk (tilt, daily cap, kill across both desks);
  - ledger rebuild.
- **Integration:** the Kraken desk on `ManualClock` with a fake feed, and the bridge carrying Kraken snapshot,
  events, and commands.
- **Synthetic session:** `buildKrakenDemo(seed)` writes `fixtures/kraken-demo-session.jsonl`, labelled SYNTHETIC.
  It includes:
  - a mover that triggers the rule and takes profit;
  - one that stops out;
  - one skipped for spread;
  - one held pair that halts;
  - a feed drop;
  - a SOL/USD price.

  `npm run demo` plays it beside the pump.fun demo, and a test asserts the scripted outcomes at speed 1 and speed 4.
- **End to end (Playwright):** the desk switch changes the radar and balance; INKY renders; the KRAKEN and COMBINED
  analytics tabs show data; there's no sideways scroll at 390 px.

## 15. Acceptance criteria

1. With network access, `npm start` shows Kraken USD movers within a few minutes of startup. The rule paper-buys,
   exits close positions, and the ledger, stats, and verdict update. The pump.fun desk behaves exactly as before.
2. `npm run demo` runs offline and shows both desks, INKY's reactions, and the KRAKEN and COMBINED analytics.
3. Unit, integration, and Playwright tests pass; `npm run check` is clean.
4. No placeholders, TODOs, or unseeded randomness in product code.
5. The README covers the Kraken desk: settings, failure modes and what to do, data files, and the key-safety rules for
   the later live phase.
6. No code path reads, stores, or asks for Kraken API keys.

## 16. Security

- No Kraken credentials exist in this phase.
- For the later live phase, keys will come only from the local `.env`, never from the browser or chat. They will be
  created with Query Funds and Create & Modify Orders only, never Withdraw Funds, and restricted to the owner's IP.
- Kraken commands from the browser are zod-validated. The pair must be in the current universe, and settings patches
  are clamped to the hard caps.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Kraken v2 field names differ from expectations | Defensive parser, raw sample capture, drop counter, first run on the owner's machine in paper |
| Public REST limits stricter than 1 request/s | Backoff on 429; the scanner works from live bars alone after warm-up |
| Fee tier differs from 0.80% | `paper.takerFeePct` setting; the README tells the owner to set it from their account |
| Momentum after costs loses money | Paper only, with a verdict after 50 closes, before any live phase |
| Some assets unavailable in the owner's jurisdiction | Irrelevant to paper. Checked before any live phase. |
| Hundreds of pairs strain the browser | Only the top 50 movers and held or pinned pairs are sent; prices are throttled |

## 18. Parking list

- Live Kraken trading with the owner's keys, caps, and an arming step (its own spec).
- Kraken account analytics from a read-only key.
- Non-USD quote pairs.
