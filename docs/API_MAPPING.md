# Birdeye Data API mapping

Which Birdeye Data endpoint powers each feature, and why. The accounting policy
(what counts as a buy, how transfers affect basis) lives in this repo rather
than in an aggregate PnL endpoint. That way every audited number can show its
inputs and flag missing basis, instead of returning a conclusion.

| Feature | Endpoint | How it is used |
|---|---|---|
| Price chart and replay candles | `GET /defi/v3/ohlcv` | One request per 5,000 candles from 1m to 1D. Market candles are never rebuilt from raw transactions |
| Board candidates | `GET /defi/v2/tokens/top_traders` | Six ranking lenses, unioned so one ranking's blind spots do not shape the board |
| Fast PnL baseline | `GET /wallet/v2/pnl/multiple` | Weighted average cost, batches of 50 wallets. A wallet missing from the response means "not answered", not $0 |
| Quantity truth | `GET /wallet/v2/balance-change` | Every token-account row is summed per transaction signature, so a routed swap counts once |
| Swap side and execution price | `GET /defi/v3/token/txs` with `owner` | Prefer `volume_usd / token quantity`, then the leg price, then OHLCV. Fallback coverage is tracked |
| Token name, decimals and logo | `GET /defi/v3/token/meta-data/single` | Board header, video header and result card |
| Supply, market cap and holders | `GET /defi/v3/token/market-data` | Entry market cap on the video (average buy price × circulating supply) and the board's MC and holder line |
| Spot mark | `GET /defi/price` | Marks open inventory for unrealized PnL |
| Wallet labels (extension) | `POST /identity/v1/multiple` | Exchange, protocol and KOL labels for board rows |
| Wallet mode token list | `POST /wallet/v2/pnl/details` | `pnl_method=wac`, newest trade first, 100 per page. SOL, USDC, USDT, USD1 and PYUSD rows are hidden: they are swap legs, and Birdeye's wallet summary already leaves them out |
| Wallet mode holdings | `GET /wallet/v2/current-net-worth` | Current value, price and logo; untraded holdings (airdrops, transfers) are listed as "held, no trades" |
| Wallet label | `GET /identity/v1/single` | Optional; most wallets return an empty identity. KOLs come back as e.g. `KOL: slingoor` |
| Names and logos in bulk | `GET /defi/v3/token/meta-data/multiple` | 20 mints per call for traded tokens the portfolio does not cover |

## Production request flow

```text
mint
 ├─ Token Metadata V3 ───────────────────────────────┐
 ├─ OHLCV V3 ─────────────────────────────── chart  │
 └─ Top Traders × six ranking lenses                │
             │                                       │
             └─ union + dedupe candidate wallets    │
                            │                         │
                            ├─ Wallet PnL Multiple, WAC (batches of 50)
                            │          └─ fast board baseline
                            │
                            └─ top N audit workers
                                ├─ Wallet Balance Change (mint-filtered)
                                ├─ Token Transactions V3 (mint + owner filtered)
                                └─ unmatched balance deltas → transfers
                                         │
                                  join by signature
                                         │
                                  conservative WAC ledger
                                         │
                                  confidence + Δ vs Birdeye WAC
```

## Why six nomination lenses

One ranking cannot recover both ends of the story. The candidate set unions:

- total PnL descending;
- total PnL ascending;
- realized PnL descending;
- unrealized PnL descending;
- USD volume descending;
- remaining holding descending.

This captures closed winners, current bag holders, large losers, and high-volume
wallets that would otherwise disappear from a single top-N query.

## Pagination rule

Birdeye's token-transaction and wallet-balance-change endpoints use offsets capped at
10,000. Reaching the cap cannot mean “done.” The implementation recursively
splits the requested time range and re-fetches both halves. If more than 10,000
events occur in one second or the configured event ceiling is reached, the row
is explicitly marked truncated and cannot receive high confidence.

The two transaction endpoints do not share the same time-bound contract. Live
Trader Trades Seek By Time rejects sending `before_time` and `after_time`
together (`422: one of either before_time or after_time`). Token Transactions
V3 instead requires both when either bound is supplied and limits their span to
30 days. Wallet audits first load mint-filtered balance changes, then query only
the 29-day buckets that actually contain changes. Those independent buckets and
known offset pages run concurrently behind the client's request gate. Repeated
analyses are promise-deduplicated and cached for the configured TTL.

Token Transactions V3 with `owner` and no time bounds does not page back
through a busy token's history: on BONK it returned zero rows for a wallet with
68 trades. The 29-day buckets are therefore required, not an optimisation.
Its `tx_type` also accepts `buy` and `sell`; the sampled replay for very active
wallets reads one page of each per window so sells are never crowded out by a
buy burst.

Wallet Transfer is not on the critical PnL path. Its data only adds counterparty
labels: unmatched signed balance deltas already identify transfer-in and
transfer-out events without another cursor-paginated request chain.

## Birdeye integration edge case

Do not force `ui_amount_mode=scaled` on OHLCV V3 for an ordinary SPL token.
During live validation, BONK returned a successful response with zero candles
when that parameter was present and returned the expected candles without it.
The adapter therefore leaves OHLCV in its default raw mode and reserves scaled
amount mode for wallet balance/trade endpoints where quantity normalization is
required.

Official references:

- [Birdeye Wallet PnL tracker](https://data.birdeye.so/docs/use-cases/portfolio-and-wallets/wallet-pnl-tracker)
- [Birdeye Top Traders](https://data.birdeye.so/docs/data-api/wallet-networth-pnl/get-defi-v2-tokens-top-traders)
- [Birdeye Token Transactions V3](https://data.birdeye.so/docs/data-api/transactions/get-defi-v3-token-txs)
- [Birdeye Wallet Balance Change](https://data.birdeye.so/docs/data-api/balance-transfer/get-wallet-v2-balance-change)
- [Birdeye Wallet Transfer](https://data.birdeye.so/docs/data-api/balance-transfer/post-wallet-v2-transfer)
- [Birdeye OHLCV V3](https://data.birdeye.so/docs/data-api/price-ohlcv/get-defi-v3-ohlcv)
