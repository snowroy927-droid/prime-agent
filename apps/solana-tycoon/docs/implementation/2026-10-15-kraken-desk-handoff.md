# Kraken desk hand-off: SUPER C SNIPER

Date: 2026-10-15. Branch `claude/gamified-solana-analytics-5ok16l`, PR #1 (draft).

## Status

The Kraken desk (paper trading on Kraken's live public prices) is complete:

- All 14 plan tasks are done (`docs/implementation/2026-10-15-kraken-desk-plan.md`, spec
  `docs/specs/2026-10-15-kraken-desk-design.md`, both approved by the owner on 2026-10-15).
- A fresh reviewer reviewed the whole branch (780fbf6..f2b532c) and gave the verdict "With fixes": 0 critical,
  4 important. All 4, plus 2 minors re-graded to important, are fixed in `bccc8bf`, `60ba8b7`, `1b9e9df`, and
  `80953e6`. Each fix has a test that failed first.
- No code path reads, stores, or asks for Kraken API keys. Live Kraken trading does not exist.

Verification on `80953e6`, run from `apps/solana-tycoon/`:

- `npx vitest run`: 51 files, 340 tests pass.
- `npm run check` (Biome and TypeScript): clean.
- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`: 6 pass.
- `grep -rnE "TODO|FIXME|lorem|Math\.random" src scripts` and `grep -rniE "api[_-]?key|secret|KRAKEN_KEY" src`:
  nothing.

Not verified: real Kraken traffic. The build container cannot reach api.kraken.com or docs.kraken.com. The README's
"What this build assumes about Kraken" lists what the first live run should confirm.

## Rulings made during execution

Every decision taken on the owner's behalf, in the order made, each with its cost if wrong.

- T2 SettingsStore<T>: plan's pump call `new SettingsStore(path, applySettingsPatch(DEFAULT_SETTINGS, modeDefaultsFor(mode)), applySettingsPatch)` passes a Result where T is required. Ruling: add `createPumpSettingsStore(filePath, modeDefaults)` in settingsStore.ts that resolves defaults (throwing on invalid, as today) and builds SettingsStore<Settings> with applySettingsPatch — cost if wrong: one helper.
- T11 consumes KrakenTrophyId, which T12 produces (later task). Ruling: KRAKEN_TROPHIES / KrakenTrophyId / unlockedTrophies move into Task 11 (progression.ts); Task 12 consumes them for the office shelf — cost if wrong: none, same code earlier.
- Task 1: Ruling: guard tests now build RiskGuard with pumpLimits/PUMP_RISK_COPY and pass outcomes, and two tests that pinned protocolVersion 1 now expect 2 — both follow directly from Task 1's interface and version change — cost if wrong: none. store.ts, TopBar.tsx and director.ts needed no edits (they never read the renamed fields).
- Task 2: Ruling: SUPERSEDES the pre-flight createPumpSettingsStore ruling — the generic store is JsonSettingsStore<T>(filePath, defaults, apply) and the pump.fun SettingsStore extends it with its old constructor, so no pump call site changes; later tasks use JsonSettingsStore<KrakenSettings> where the plan says SettingsStore<KrakenSettings>; settings.ts exports parsePatched/PatchResult for both desks — cost if wrong: a rename. quoteSell does not enforce ordermin (paper can always close a remainder) — cost if wrong: paper sells of dust a live account could not place.
- Task 3: Ruling: PairUniverse.startHourlyRefresh takes an onError callback (plan signature had none) so a failed hourly refresh is reported instead of swallowed — cost if wrong: one parameter.
- Task 5: Ruling: the radar filters on the volume floor only; spread is shown as the rule status (wide_spread) instead of hiding the pair — the demo's WIDEBOI and the 'top skip reasons' chart need wide-spread movers visible with their reason (spec 5 says 'pass the filters') — cost if wrong: a few wide-spread pairs on the radar. RuleInput gains tzOffsetMin and ScannerDeps gains tzOffsetMin so the cooldown reason prints local time; Scanner also exposes volumeUsd24h(wsname) for the desk. small_move copy says 'Down x%' for negative moves.
- Task 6: Ruling: a pair the universe no longer knows is refused as 'Pair halted' (a vanished pair is halted); a sell fill records gross = proceeds + fees so rebuild's 'proceeds = usd - fees' matches the pump.fun convention; KrakenFillSchema lives in kraken/ledger.ts for Task 9 to reuse — cost if wrong: none.
- Task 8: Ruling: the desk emits through a `emit: (event: KrakenEvent) => void` dep (KrakenEvent union in shared/kraken.ts) instead of `bus: EngineBus` — the bus's EngineEvent type gains Kraken events only in Task 9; Task 9 wires emit into the bus — cost if wrong: one adapter.
- Task 8: Ruling: the take-profit test raises the bid ~10%, not the plan's 7% — round-trip costs (0.8% fee each way + 0.15% slippage each way) mean +7% bid is about +5% PnL, under the 6% target — cost if wrong: none (the rule itself is the spec's).
- Task 8: Ruling: skips count once per pair, reason and hour (a mover skipped on every 5 s scan is one skip) and use human labels ("Wide spread", "Tilt cooldown", "Max positions reached") — otherwise counts grow 720x per hour per mover — cost if wrong: different chart scale.
- Task 8: Ruling: REST OHLC rows are parsed as [time s, open, high, low, close, vwap, volume, count] (Kraken's documented layout from memory; unverified per spec Section 2), malformed rows skipped and a seeding failure logged once per pair with live bars as the fallback — cost if wrong: no seeded history until live bars cover 15 minutes.
- Task 8: Ruling: the desk builds its Scanner internally and exposes quote(pair)/isHalted(pair) so the executor can be built first with closures (as pump.fun's globals closure); positions re-emit when they go stale on the 1 s tick so the page shows STALE — cost if wrong: none.
- Task 9: Ruling: Engine deps take `clock` beside `bus` so the offline log line carries engine time — cost if wrong: none.
- Task 9: Ruling: Kraken commands to a desk that failed to start return "Kraken desk is offline", and kill/resume skip that desk (no live prices to sell at) — cost if wrong: positions reloaded from a previous run stay open until a restart brings the desk online.
- Task 9: Ruling: RESUME after a kill, from either desk's resume command, lifts the kill on both desks; outside a kill, pause and resume stay per desk (spec 7: pause/resume act on the desk on screen, KILL on both) — cost if wrong: one extra click.
- Task 9: Ruling: the web store lists every Kraken event as an explicit no-op until Task 11, so the reducer switch stays exhaustive; Kraken data reaches the page only through snapshots until then — cost if wrong: none once Task 11 lands.
- Task 9: Ruling: the bridge kraken_close test passed at runtime before implementation (the bridge forwards bus events as-is); its RED was the compile error, since EngineEvent lacked kraken_close — cost if wrong: none.
- Task 9: Ruling: extracted test/helpers/pumpCore.ts and test/helpers/krakenDesk.ts so the engine test runs both real desks on one ManualClock; tradingCore and kraken-desk tests now use them — cost if wrong: none.
- Task 9: Ruling: KRAKEN=off (case-insensitive) turns the desk off; any other value or unset keeps it on, per the brief — cost if wrong: none.
- Task 10: Ruling: added src/engine/kraken/assemble.ts (assembleKrakenDesk) so main.ts paper, demo and replay and the test helper share one wiring — cost if wrong: none.
- Task 10: Ruling: ReplayKrakenSource answers REST from the latest body at or before now, else the first recorded body for that query (a live recording writes the response after the request it answers); only an unrecorded query throws "Not in recording" — cost if wrong: a replayed request can see a response a few hundred ms early.
- Task 10: Ruling: replay shifts market-data timestamps by (replay start - meta.createdAt); shifted OHLC rows carry milliseconds, which parseOhlc accepts, to avoid fractional-second float error — cost if wrong: none.
- Task 10: Ruling: a --replay recording with no Kraken lines leaves the Kraken desk off (snapshot kraken: null) rather than OFFLINE with "Not in recording" — cost if wrong: an older recording shows no Kraken desk instead of an offline one.
- Task 10: Ruling: the Kraken demo lives in its own fixture (fixtures/kraken-demo-session.jsonl); make-demo writes both through a shared formatRecording, and demo.test checks both checked-in fixtures match their builders — cost if wrong: none.
- Task 10: Ruling: the synthetic session lists SOL/USD in AssetPairs (flat, never passes the rule) so it shows on the radar; its ~$150 price is synthetic — cost if wrong: one extra calm radar row.
- Task 10: Ruling: the Recorder writes Kraken feed status only when it changes, because the live feed re-sends "live" to report dropped counts; ReplayKrakenSource.setSymbols is a no-op since a recording plays every message it holds — cost if wrong: none.
- Task 11: Ruling: BarBook keeps 61 one-minute bars (the current minute plus the 60 before it), not the spec's 60 — with 60, the reference bar for the 60-minute change was always just dropped and 1H read "--" on every pair, live too; found in the Task 11 screenshot, fixed test-first (3391167) — cost if wrong: one extra bar per pair.
- Task 11: Ruling: plan-vs-spec conflict — Task 6/8 refused a manual SELL on a HALTED pair; spec Section 13 (binding) says "manual SELL tries at the last bid". Manual SELL and KILL now fill a halted position at the bid and pair details from its last valuation while listed; with no such valuation (e.g. halted at restart) it still refuses "Pair halted" (fb09d5a) — cost if wrong: a delisted pair's paper position closes at a price Kraken may no longer honour live; paper only.
- Task 11: Ruling: KrakenView.orders holds KrakenOrderUpdate keyed by pair (the brief's OrderUpdate is the pump.fun type keyed by mint); GameState gains selectedPair for the Kraken radar beside selectedMint — cost if wrong: none.
- Task 11: Ruling: activeDesk() falls back to PUMP while the Kraken desk is off (snapshot.kraken null), and screenTier/HUD/scene palette all use it; the KRAKEN switch is disabled with "KRAKEN=off" in its title — cost if wrong: none.
- Task 11: Ruling: the Kraken reducer does not log fills or closes because the desk already sends them as "Kraken:" log events; the dropped-message line says "1 message" in the singular, as the pump.fun feed line does — cost if wrong: none.
- Task 11: Ruling: settings field definitions moved to hud/settingsFields.ts (PUMP_SECTIONS, KRAKEN_SECTIONS); SettingsPanel takes sections, values and the auto toggle, and gains a boolean field kind for rule.requireRising5m; a test pins that every Kraken setting has a field — cost if wrong: none.
- Task 11: Ruling: formatUsdShort moved from engine/kraken/rule.ts to shared/kraken.ts so the page can format radar volumes without importing engine code — cost if wrong: none.
- Task 11: Ruling: rule statuses map to chip colours — eligible green, warming_up as pending, held/cooldown neutral, the five skip statuses amber (new v-skip); text is the status with spaces, so warming_up reads WARMING UP — cost if wrong: colours only.
- Task 11: Ruling: the brand row wraps (flex-wrap) so logo, badges and the desk switch fit at 390 px; measured 0 px sideways scroll on both desks at 390x844 and 1440x900, no console errors, movers visible in under 25 ms of switching — cost if wrong: none.
- Task 12: Ruling: the brief expects "the trophy shelf appears after the MOONCAT win", but MOONCAT wins $3.65 and the spec's first trophy is at $50 peak; the shelf plank is always on INKY's desk and each cup appears only when its trophy unlocks, so the demo shows the empty shelf — unlocking is pinned by the progression and store tests — cost if wrong: none; the spec thresholds stand.
- Task 12: Ruling: the spec's "wall ticker of the top 5 movers" is a back-wall screen (ScreenId "ticker", 128x52) above the vault spot, because five "SYM +x.x%" lines cannot fit the 48x36 desk monitors; INKY's desk monitor ("inky") shows the top movers as bars — cost if wrong: one extra screen id.
- Task 12: Ruling: INKY's station is along(10, 3), the open floor right of GLOOP, chosen from 1440x900 and 390x844 screenshots: no tag overlaps, no console errors — cost if wrong: layout only.
- Task 12: Ruling: coin and confetti reactions take an optional `at` cast id (default GLOOP/CEO) so Kraken coins burst at INKY; Kraken combo banners fire only while the Kraken desk is selected, matching the screen tier; a failed Kraken order shows INKY's fail with the error, mirroring REX — cost if wrong: none.
- Task 12: Ruling: INKY's skin is palette 12 (red), which no other cast member uses as skin or body; the voxel test counts tentacle stalks (each tentacle is a stalk plus a curled tip) — cost if wrong: none.
- Task 13: Ruling: series colours are pump.fun #3987e5 (blue) and Kraken #d55181 (magenta) from the dataviz reference dark slots; validate_palette.js --mode dark --surface #0d1122 passes every check (CVD dE 15.9, normal dE 26.5, >= 3:1). Blue+amber (#c98500) scored higher but amber reads as the terminal's orange loss colour — cost if wrong: colours only.
- Task 13: Ruling: the terminal is refactored into one DeskReport model shared by the PUMP.FUN and KRAKEN tabs; the verdict label becomes "<DESK> VERDICT (<mode>)" and the KRAKEN activity tile is MOVERS (24H) in place of CHECK PASS RATE — cost if wrong: copy only.
- Task 13: Ruling: with no SOL/USD price the COMBINED total reads "--" with the note, the pump.fun tile stays in SOL, and the chart shows an empty state rather than two units on one axis (dataviz: never dual-axis); the COMBINED table lists both desks' trades in their own units — cost if wrong: none.
- Task 13: Ruling: the combined chart carries an HTML legend as well as direct end labels (dataviz: 2+ series always get a legend), and drawLines orders hits by x so arrow keys walk through time across both series — cost if wrong: none.
- Task 13: Ruling: the terminal opens on the selected desk's tab; KRAKEN and COMBINED are disabled while the Kraken desk is off. Verified at 1440x900 and 390x844: no sideways scroll, both series labelled, no console errors, arrow-key and hover readouts show "PUMP.FUN 08:48 $9.13" style tips — cost if wrong: none.
- Task 14: Ruling: the e2e tests passed on first run because Tasks 11-13 already built what they check; they are regression guards — cost if wrong: none.
- Task 14: Ruling: the README names "Kraken's status page" rather than a URL, since status.kraken.com could not be checked from the container; .env.example already carried KRAKEN=on from Task 9 — cost if wrong: none.
- Final: Ruling: re-graded minor 7 (volume-surge passes trivially with < 60 min of bars) to Important — a reasonable user gets a momentum rule that silently drops its surge filter for live-only pairs, biasing the very measurement the desk exists to make — cost if wrong: one rule change.
- Final: Ruling: re-graded minor 9 (a corrupt settings-kraken file stops the whole engine) to Important — spec §13 says a Kraken startup failure leaves pump.fun running; the owner would lose pump.fun over a Kraken file — cost if wrong: small wiring change.
- Final: Ruling: finding 4 (XBT/XDG symbols) verified in part — Kraken's v2 guide (docs.kraken.com spot-ws-intro, via web search 2026-10-15) says v2 uses BTC where v1 used XBT and rejects "XBT/USD"; XDG->DOGE follows the same rename but is unverified, so failed subscribe replies are also logged — cost if wrong: one wrong alias, surfaced by the log.
- Final: Ruling: declined-to-judge "Kraken v2 field names" — stands as unverified by design (spec §2), the parser counts and saves unknown shapes — cost if wrong: first live run shows drops.
- Final: Ruling: declined-to-judge "INKY model, layout, chart colours" — checked by screenshots at both sizes and the dataviz validator — cost if wrong: visuals only.
- Final: Ruling: declined-to-judge "a failed KILL sell is not retried" — mirrors Milestone 1 pump.fun; the position stays visible with SELL available — cost if wrong: one more click.
- Final: Ruling: declined-to-judge "crypto.randomUUID / getRandomValues for ids and jitter" — not trading randomness; same as Milestone 1 — cost if wrong: none.
- Final: Ruling: declined-to-judge "--record files grow with every Kraken message" — the spec requires recording them and the flag is opt-in — cost if wrong: disk use on long recordings.
- Final: Ruling: declined-to-judge "ticker updates on trades, not quote changes" — spec facts table defines it; the stale-quote fix below bounds its effect on fills — cost if wrong: none.
- Final: Ruling: declined-to-judge "movers-per-hour and skip counts reset on restart" — spec §13 restart row covers positions and stats only — cost if wrong: a gap in one chart after restarts.
- Final: Ruling: declined-to-judge "manual buys bypass the daily loss cap" — Milestone 1 RiskGuard semantics; the spec's cap stops auto-buys — cost if wrong: none.
- Final: Ruling: declined-to-judge "trophies from the newest 500 closes" — same as Milestone 1 office upgrades — cost if wrong: a trophy computed from a window after 500 closes.
- Final: Ruling: declined-to-judge "verdict label copy on PUMP.FUN tab" — copy only — cost if wrong: none.
- Final: Ruling: declined-to-judge "Playwright not re-run by reviewer" — implementer ran 6/6 on f2b532c and reruns after the fix pass — cost if wrong: none.
- Final: fixed important 1 (paper buys on stale prices) — kraken-paper "refuses a buy when the ask is older than priceStaleSec, but still sells on it", kraken-desk "refuses a manual buy on a price older than priceStaleSec" and "skips auto-buys while the Kraken feed is down and counts why" RED->GREEN, suite 330/330 (bccc8bf). Ruling: FakeKrakenFeed now emits "live" on start like KrakenFeed does on open, and the balance test sends a ticker first — cost if wrong: none.
- Final: fixed important 2 (dashboard waits on Kraken start) — engine "serves pump.fun while the Kraken start is still waiting on the network" and rest "gives up on a server that accepts the connection and never answers" RED->GREEN; fetchGet has a 10 s deadline; suite 336/336 (60ba8b7). Ruling: engine tests that trade on Kraken now await krakenSettled(), since the desk starts in the background — cost if wrong: none.
- Final: fixed important 3 (only HTTP 429 retried) — rest "retries network errors, 5xx, and rate limits reported inside the body" and engine "retries a failed Kraken start in the background and brings the desk online" RED->GREEN; retries at 30 s doubling to 5 min, then a fresh snapshot; suite 336/336 (60ba8b7). Ruling: the envelope-error test now uses a non-retryable "EQuery:Unknown asset pair" — cost if wrong: none.
- Final: fixed re-graded 7 (volume surge trivial on short history) — kraken-rule "measures the volume surge against the minutes of history it actually has" RED->GREEN, suite 340/340 (80953e6). Ruling: the pace is volume over the minutes held scaled to 15 min, which is stricter than the 60-minute rule on thin history (cautious) — cost if wrong: fewer buys in a pair's first hour after a failed seed.

## Deferred minor findings

From the final review; none blocks the paper desk.

- excluding a held base via scan.excludeBases halts that position (no stop-loss) and settings changes wait up to an hour for the refresh.
- a position halted at startup (no last listed bid) cannot be closed; it holds a slot and its reserved cost.
- halted sells do not log the bid and its age in the log line or ledger.
- every dropped message emits a kraken_feed event and every held-pair ticker an unthrottled kraken_position event to the page.
- toScaled truncates the ask (should round up for buys); fee bps uses Math.round; skipSeen grows without bound; seeding logs one warning per pair under sustained 429s; cryptoUnit is copied into three files.
- no desk tests for "halted with no last valuation -> Pair halted" or KILL skipping that position.

## Next

- Owner: in `apps/solana-tycoon/`, run `npm install && npm run demo` to see both desks offline, then `npm start` for
  the first live paper run. Check the event log for "Kraken: refused" or "Kraken: N messages dropped" lines and set
  `paper.takerFeePct` to your account's taker fee in SETTINGS on the KRAKEN desk.
- Engineering: Milestone 2, live signing for pump.fun, then a live Kraken phase only if the Kraken verdict after 50
  closes says the rule is not losing money.
