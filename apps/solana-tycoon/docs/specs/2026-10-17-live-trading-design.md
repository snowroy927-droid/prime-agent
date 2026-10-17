# SUPER C SNIPER: Live Trading (Milestone 2) - Design Spec

Date: 2026-10-17. Supersedes Section 9 of `2026-10-15-super-c-sniper-design.md`. Every other section of that spec
still holds.

## 1. Intent

The pump.fun desk trades real SOL from a burner wallet on the owner's machine. It uses the same launch feed, rug
checks, exits, risk guard, ledger, and analytics as paper mode. Only the fill changes: a paper fill is priced from the
SDK's quote math, and a live fill is a signed, confirmed Solana transaction whose result is read back from the chain.

### Decisions made with the owner (2026-10-17)

| Topic | Decision |
|---|---|
| Route | The engine signs and sends directly to the Pump program through the owner's own RPC. No third-party bot or transaction API. |
| Audience | Personal bot. One wallet, one owner, no multi-user features. |
| Sending | Plain RPC `sendRawTransaction` with a compute-unit priority fee. Jito bundles are parked. |
| Automation | Live auto-snipe is allowed within the caps, but only while armed. |
| Gate | Live trading works as soon as it is built. There is no paper-verdict lock. |
| Starting limits | The paper defaults: 0.05 SOL per buy, 3 positions, 0.15 SOL daily loss cap, auto-snipe on, and a wallet banner above 1 SOL. |
| Dry run | Included: `MODE=live --dry-run` builds, simulates, and checks real trades and never sends them. |

### Money mechanism

This tool makes money only through the owner's own trades. Live trading is an experiment whose budget is the SOL the
owner puts in the burner wallet. The analytics terminal gives live mode its own verdict after 50 live closes (Section
11 of the Milestone 1 spec).

### Non-goals

- Buying on PumpSwap pools. As in paper, buys need a live bonding curve (the `curve_live` rug rule). Sells work on the
  curve or on the pool after migration.
- Cashback coins. pump.fun's `create_v2` no longer creates them, and the v3 trade instructions refuse them, so the
  live executor refuses them too, with the reason in the log.
- Live Kraken trading. In `MODE=live` the Kraken desk keeps running in paper mode on its own paper ledger.

## 2. Verified facts this design depends on

Checked 2026-10-17. "Package" means the published npm tarball, unpacked and read directly.

| Fact | Source |
|---|---|
| `@pump-fun/pump-sdk` latest is 4.1.0 (2026-10-13). 4.0.0 is from 2026-10-08. The app pins 3.2.0 (2026-10-07). | npm registry `time` |
| The buy and sell builders are identical in 3.2.0, 4.0.0, and 4.1.0. Diffing `dist/index.d.ts`: 3.2.0 to 4.0.0 drops one field from a coin-creation quote type; 4.0.0 to 4.1.0 changes only `create_v2` quote-chain docs and errors. The pump SDK stays at 3.2.0. | Package type declarations |
| 3.2.0 exports `buyExactQuoteInV3Instructions`, `sellV3Instructions`, `fetchBuyState`, `fetchSellState`, `PUMP_PROGRAM_ID`, `PUMP_AMM_PROGRAM_ID`, `PUMP_FEE_PROGRAM_ID`, and `MAYHEM_PROGRAM_ID`. | Installed package |
| v3 trades refuse cashback coins (error 6094, `CashbackCoinNotSupportedError`). `create_v2` rejects new cashback coins (6082). v3 buys create the buyback token account idempotently. | SDK readme |
| `@pump-fun/pump-swap-sdk` latest is 2.1.0 (2026-10-07). The installed 1.20.0 has no `Pool.protocolFees` or `Pool.creatorFees` and no v2 pool trades. In 2.x, sells must be checked against the vault net of those fee buckets, as the program does. The swap SDK is upgraded to 2.1.0. That release is 10 days old, which satisfies the repo's 7-day rule. | npm registry, package type declarations, readme "v2 trades and fee sweeps" |
| `@solana/web3.js` 1.99.0 `simulateTransaction` accepts `sigVerify`, `replaceRecentBlockhash`, `accounts`, and `innerInstructions`. | Installed type declarations |
| `solana-keygen new --outfile <path>` writes an unencrypted keypair file. A BIP39 passphrase protects only the seed phrase. | docs.anza.xyz/cli/wallets/file-system |
| The Solana CLI installs with `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`. | docs.anza.xyz/cli/install, solana.com/docs/intro/installation |
| A token account's rent is 0.00203928 SOL (`TOKEN_ACCOUNT_RENT_LAMPORTS`, already used by paper fills). Closing an empty account refunds it to the destination. | Milestone 1 code; SPL Token `CloseAccount` |

Unverified, and handled defensively:

- **No mainnet run.** The build machine cannot reach Solana RPC, PumpPortal, or pump.fun. The first live run is the
  owner's, following the README runbook (Section 10).
- **Explorer link.** Log lines link `https://explorer.solana.com/tx/<signature>`. That a link without a `cluster`
  parameter opens mainnet is unconfirmed. The signature is always printed in full.
- **Slippage default.** 10% is a judgment for fresh launches, not a sourced figure. Paper assumes 3%.
- **Fee rates.** pump.fun's fee pages could not be opened from the build machine. No fee rate is hard-coded: every
  quote uses the SDK's fee math, and live fills record what the chain actually charged.
- **Public RPC.** Whether `api.mainnet-beta.solana.com` lands transactions reliably is unverified. The README
  recommends a dedicated provider, and the RPC chip keeps showing PUBLIC.

## 3. Architecture

`LiveExecutor` implements the existing `Executor` interface (`src/engine/trader/executor.ts`), so `TradingCore` keeps
its order, position, exit, kill, and ledger logic. New code lives in `src/engine/live/`:

```
src/engine/live/
  wallet.ts      load KEYPAIR_PATH; expose publicKey and sign(); permission warning
  build.ts       unsigned buy/sell transactions from the SDKs, compute budget, close-account on full sells
  simulate.ts    sizing and validation simulations; balance and inner-instruction extraction
  validate.ts    pure checks on a simulated transaction (Section 5)
  send.ts        send, confirm with blockhash expiry, signature lookup, sell retries
  fill.ts        real fill from a confirmed transaction's pre and post balances
  arming.ts      armed/disarmed state, ARM text check
  executor.ts    LiveExecutor: build -> simulate -> validate -> (dry run stops here) -> sign -> send -> fill
  status.ts      wallet balance poll, over-budget flag, LiveStatus for the snapshot
```

The wallet's secret key exists only inside `wallet.ts`. No other module, log line, ledger record, snapshot, or event
receives it.

### Changes to existing code

- `main.ts`. `MODE=live` no longer exits. It requires a readable `KEYPAIR_PATH`, builds the wallet and
  `LiveExecutor`, and passes `dryRun` from the new `--dry-run` flag. `--dry-run` without `MODE=live` is an error.
  The Kraken desk runs in paper mode.
- `env.ts`. Adds `MAX_WALLET_SOL` (default 1.0, positive number).
- `settingsStore.ts`. `modeDefaultsFor("live")` no longer forces `autoSnipe: false`. Live starts from the paper
  defaults.
- `shared/settings.ts`. Adds a `live` section, validated like the others:
  `{ slippagePct: 10 (0 < x <= 50), priorityFeeSol: 0.0005 (>= 0, <= 0.01), reserveSol: 0.01 (>= 0) }`.
  `paper.*` is ignored in live mode.
- `TradingCore`.
  - A new `trading` dep answers `canBuy(lamports): { ok } | { ok: false, reason }` before an order is placed. Paper
    keeps today's ledger balance check ("Insufficient paper balance"). Live checks armed, then wallet balance against
    buy plus maximum fees plus rent plus `live.reserveSol`: "Not armed", or "Not enough SOL (keeping 0.01 for sells)".
    A refused auto-snipe is logged as a skip, as today. No pending order is emitted.
  - The balance shown is the live wallet balance in live mode.
  - KILL disarms in live mode, after placing the kill sells.
- `ledger`. Adds a `submitted` record `{ positionId, side, signature, lastValidBlockHeight, ts }`, appended before a
  transaction is sent. On start, a `submitted` record with no matching fill is resolved on-chain (Section 6).
- Paper fills. A 100% sell adds back the token-account rent the buy charged, matching the live close-account refund.
  This keeps paper and live results comparable.
- `quote.ts` and `chain`. Pool snapshots carry `feeBucketsTotal` (`protocolFees + creatorFees`), and paper pool sells
  pass it to `sellBaseInput`, as swap SDK 2.x requires.
- Protocol. `PROTOCOL_VERSION` goes from 2 to 3.
  - New commands: `arm { text }` and `disarm`.
  - The snapshot gains `live: LiveStatus | null`, where
    `LiveStatus = { wallet: string, balanceLamports: string, armed: boolean, dryRun: boolean, overBudget: boolean,
    maxWalletLamports: string }`.
  - New event: `live_status`.
  - The page shows a protocol-mismatch error against an older engine, as today.
- HUD.
  - The mode badge reads LIVE (red) or LIVE DRY RUN.
  - An ARM button opens a dialog with one text field and the prompt "Type ARM <last 4 of wallet>". When armed, the
    chip reads ARMED and DISARM is offered.
  - A wallet chip shows the short address and SOL balance.
  - Over budget, a persistent banner reads "Wallet holds X SOL. This does not look like a dedicated burner."
  - Fill and failure log lines carry the signature and explorer link.

## 4. Building a trade

All amounts are integers: lamports, and token base units with 6 decimals.

**Buy (bonding curve).**
1. `fetchBuyState(mint, user, tokenProgram)`. Refuse if the curve is complete, migrated, mayhem, or cashback.
2. Quote `quotedTokens = getBuyV3TokenAmountFromQuoteAmount({ ..., amount: buyLamports, curveBaseTokenBalance })`.
3. Build `buyExactQuoteInV3Instructions({ quoteAmount: buyLamports, amount: quotedTokens,
   slippage: slippagePct, quoteTokenProgram, ... })`.
   - The SDK sets the instruction's minimum to `lessSlippage(quotedTokens, slippagePct)`:
     `quotedTokens - quotedTokens x floor(slippagePct x 10) / 1000`. Slippage is a percent with 0.1% resolution, read
     from the installed 3.2.0 code.
   - The engine computes the same `minTokens` for the checks and does not apply slippage itself.
   - The SOL spent on the trade is exactly `buyLamports`. Slippage only lowers the tokens accepted.

**Sell (bonding curve).**
- `fetchSellState`, then `sellV3Instructions` with `amount` the position's tokens and a minimum SOL out of the quote
  times `(1 - slippagePct/100)`.

**Sell (PumpSwap, after migration).**
- swap SDK 2.1.0 `swapSolanaState(pool, user)`, then `sellBaseInput(state, tokens, slippage, { v2: true })`. The SDK
  uses v2 where the pool supports it and v1 elsewhere.

**Full sells close the token account.**
- When the sell is 100% and the wallet's token balance for the mint equals the amount sold, the transaction ends with
  the token program's `CloseAccount` to the wallet, refunding the rent.
- With any other balance (dust or a transfer in), the close is left out, so the sell still succeeds.

**Compute budget.**
1. A sizing simulation runs with a 1,400,000 compute-unit limit and no price.
2. The final transaction sets the limit to `ceil(unitsConsumed x 1.2)` and the price to
   `floor(priorityFeeLamports x 1,000,000 / limit)` micro-lamports, so the priority fee is at most
   `live.priorityFeeSol`.

## 5. Checks before signing (`validate.ts`)

The final transaction is simulated with `sigVerify: false`, `replaceRecentBlockhash: true`,
`innerInstructions: true`, and `accounts` set to the wallet and its token account for the mint. It is signed only if
every check passes. Each failure has its own message.

1. The simulation returned no error.
2. **Program allowlist.** Every top-level and inner instruction's program is one of: `PUMP_PROGRAM_ID`,
   `PUMP_AMM_PROGRAM_ID`, `PUMP_FEE_PROGRAM_ID` (pump SDK), `ComputeBudgetProgram.programId`,
   `SystemProgram.programId` (web3.js), `TOKEN_PROGRAM_ID`, `TOKEN_2022_PROGRAM_ID`, or
   `ASSOCIATED_TOKEN_PROGRAM_ID` (spl-token). `MAYHEM_PROGRAM_ID` is not allowed.
3. **Buys.** `walletSolBefore - walletSolAfter <= buyLamports + baseFee + priorityFee + rent + buyLamports / 100`.
   The token account's balance rises by at least `minTokens`.
4. **Sells.** The token account's balance falls by exactly the amount sold, or the account is closed after selling
   all of it. Wallet SOL after is at least wallet SOL before minus `baseFee + priorityFee`.
5. The fee payer and the only signer is the wallet.

Unit tests build transactions locally and run the checks on simulated results:

- an honest buy (passes);
- a buy with an extra `SystemProgram.transfer` out of the wallet (fails the SOL check);
- an instruction for an unknown program (fails the allowlist);
- a buy whose SOL decrease exceeds the bound (fails);
- a sell that leaves the wallet poorer than the fees (fails).

## 6. Sending and confirming (`send.ts`, `fill.ts`)

1. Sign with the wallet. Append the `submitted` record. Send with `sendRawTransaction(raw, { skipPreflight: true,
   maxRetries: 0 })`. The engine simulated already, and it decides retries itself.
2. Confirm at `confirmed` against the transaction's `lastValidBlockHeight`.
3. **On expiry**, `getSignatureStatuses([sig], { searchTransactionHistory: true })` first.
   - Confirmed or finalized: record the fill.
   - Landed with an error: a failed order with the program error.
   - Not found: the order failed. A buy is never re-sent. A sell is rebuilt with a fresh quote and blockhash and sent
     again, up to 3 attempts in total.
4. **Real fill**, from `getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })` pre and
   post balances.
   - **Buy:** `feesLamports = meta.fee + rentPaid`, `solLamports = (pre - post) - feesLamports`,
     `tokenAmount = token delta`.
   - **Sell:** `feesLamports = meta.fee`, `solLamports = (post - pre) + meta.fee`, which includes any rent refund.
   - Either way, `signature` is set on the `Fill`. TradingCore's cost and proceeds math then equals the wallet's
     actual SOL change.
5. **Crash recovery.** On start in live mode, each unresolved `submitted` record goes through step 3's lookup.
   Confirmed transactions become fills. Expired or not found are logged as failed. The engine always starts
   disarmed.

**Dry run.**
- Steps 1 to 3 run, meaning sections 4 and 5 (build, simulate, check), with the real wallet, and nothing is signed or
  sent.
- The executor returns a failed order whose message starts "Dry run: would buy <tokens> <SYMBOL> for <SOL> SOL"
  (or "would sell"), and all checks are listed as passed.
- No position opens, so dry run exercises buys. Sells are exercised by the first real 0.01 SOL trade.

## 7. Wallet, arming, and limits

**Wallet.**
- `KEYPAIR_PATH` points to a `solana-keygen` JSON file: an array of 64 numbers. A missing, unreadable, or malformed
  file stops the engine with a message naming the path, never the contents.
- On macOS and Linux, if the file is readable by group or others (`mode & 0o077`), the engine logs a warning with the
  `chmod 600` fix.

**Arming.**
- `arm` succeeds only when the text is exactly `ARM <last 4 characters of the wallet address>`, case-sensitive, after
  trimming spaces.
- The engine starts disarmed. A restart, KILL, or `disarm` disarms it.
- Disarmed means **no new buys**. Automatic exits, manual SELL, and KILL sells still run. An open position always
  needs its stop loss, including straight after a restart.

**Limits.**
- The paper defaults and the existing hard caps apply: 1 SOL per buy and 10 open positions.
- `live.reserveSol` (default 0.01) is never spent on buys, so sells can always pay fees.
- `MAX_WALLET_SOL` (default 1.0) shows the over-budget banner. It does not block trading.
- The wallet balance is read every 10 seconds and after every fill.

## 8. Failure handling

| Failure | What the engine does | What the owner sees |
|---|---|---|
| Not armed | Skips buys; exits and sells still run | "Skipped X: Not armed"; ARM button |
| Not enough SOL | Skips the buy | "Not enough SOL (keeping 0.01 for sells)" |
| Simulation error | Does not sign | Failed order with the program's error |
| Check fails | Does not sign | Failed order naming the failed check |
| Cashback or mayhem coin | Does not build | Failed order with the reason |
| Transaction expires | Looks up the signature; a buy is never re-sent; a sell retries up to 3 times | Fill, or a failed order saying whether it landed |
| Sell fails 3 times | The position stays open with SELL available; exits keep re-trying on price updates | Red log line with the last error |
| RPC down or rate-limited | Builds fail; nothing is signed | RPC chip DEGRADED; failed orders |
| Engine crash mid-trade | Resolves `submitted` records on start; starts disarmed | Log lines for each resolved record |
| Key file missing or malformed | Does not start | Exit message naming `KEYPAIR_PATH` |
| Key file readable by others | Starts, with a warning | Warning with the `chmod 600` fix |
| Wallet above `MAX_WALLET_SOL` | Keeps trading | Persistent red banner |

## 9. Testing

Unit and integration tests (vitest), with no mainnet:

- `validate.ts`: the five cases in Section 5, plus allowlist coverage of each listed program.
- `wallet.ts`:
  - loading a temporary keypair file;
  - a malformed file;
  - the permission warning;
  - no secret bytes in error messages or log output.
- `arming.ts`:
  - the exact text;
  - a wrong suffix;
  - case and whitespace handling;
  - disarm on KILL and restart.
- `build.ts`:
  - instruction programs and order;
  - compute-budget math;
  - the close-account rule (equal balance includes it, dust leaves it out).
- `send.ts` and `fill.ts`, against a fake connection:
  - confirmed;
  - expired then found;
  - expired then not found, for a buy (no resend) and for a sell (three attempts);
  - landed with an error;
  - fill math from pre and post balances.
- `LiveExecutor`: dry run returns the "would buy" message and never calls send; "Not armed"; "Not enough SOL".
- `TradingCore` in live mode with a fake executor:
  - a disarmed engine still runs a stop-loss exit;
  - KILL sells, then disarms;
  - crash recovery of a `submitted` record.
- The paper rent refund on a 100% sell, and pool sells with `feeBucketsTotal`.
- Protocol schema round-trips for `arm`, `disarm`, `live_status`, and the v3 snapshot.

Playwright, against a demo engine started with a fake live status:

- the LIVE badge;
- the ARM dialog flow;
- the wallet chip;
- the over-budget banner, at 1440x900 and 390x844.

## 10. README runbook: the first live trade

The README gains a "Live trading" section with these steps, written for the owner's machine:

1. Install the Solana CLI (Section 2 command) and create a burner:
   `solana-keygen new --outfile ~/.config/super-c-sniper/burner.json`. Then run
   `chmod 600 ~/.config/super-c-sniper/burner.json`. Write down the seed phrase offline.
2. Send a small amount of SOL to the burner's address (`solana-keygen pubkey <file>`) from your own wallet or
   exchange: 0.1 SOL covers the test trade and fees. The owner does this. The tool never moves funds.
3. In `.env`, set `MODE=live`, `KEYPAIR_PATH=<file>`, and `RPC_URL=<your provider>`.
4. Run `npm start -- --dry-run`. Let it log "Dry run: would buy ..." for a few approved launches. Confirm that no
   check fails.
5. Stop it, then:
   1. Run `npm start`.
   2. In SETTINGS, set `autoSnipe` off and `buySol` to 0.01.
   3. Click ARM and type the phrase.
   4. Snipe one approved coin by hand.
6. Open the explorer link from the log. Check the SOL spent and tokens received against the position. Sell 100%, then
   check the sell and the rent refund.
7. Compare `data/ledger-live.jsonl` with the explorer.
8. Set `buySol` back to 0.05 and `autoSnipe` on. The engine trades while armed, within the caps.

## 11. Acceptance criteria

Milestone 2 is done when:

1. Everything in Sections 3 to 8 is implemented, and every test in Section 9 passes.
2. `npm run check` is clean, and the Milestone 1 and Kraken suites still pass.
3. `MODE=live --dry-run` runs end to end against a fake chain in an integration test.
4. The README has the runbook (Section 10), the new settings and env key, and the failure rows.
5. No code path logs, stores, or sends the secret key. A test asserts that the snapshot and the log stream contain no
   key bytes.

## 12. Security

- The secret key comes only from the file at `KEYPAIR_PATH`, which lives outside the repository. `.env`, `data/`, and
  `*.keypair.json` stay git-ignored.
- Nothing is signed unless it passes Section 5's checks. Only the wallet signs, and only the engine process holds
  the key.
- The bridge keeps loopback binding, the session token, and the Origin check. Arming is a bridge command and needs the
  token.
- The browser never receives key material: only the public address, balance, and armed state.

## 13. Parking list

- Jito bundles for faster landing and sandwich protection.
- `@pump-fun/pump-sdk` 4.1.0. Trading is unchanged, and the upgrade is allowed from 2026-10-20 under the 7-day rule.
- Buying on PumpSwap pools.
- Cashback-coin trading through the v2 instructions.
