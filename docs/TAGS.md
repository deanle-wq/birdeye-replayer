# Tag layers: what each marker means

Every marker keeps Birdeye's own definition of the wallets behind it, so a
viewer can check it against the Birdeye docs. Nothing is inferred from price
action.

## Wallet cohorts (Wallet Tags Tracker)

`GET /token/v1/wallet-tags-tracker` returns, per time bucket, the buy and sell
volume and wallet counts of four cohorts:

| Tag | Birdeye's definition |
|---|---|
| `smart_trader` 🧠 | A non-bot wallet ranked in the top 90-day realized PnL, with realized PnL above $10,000 |
| `kol` 🎤 | A tracked key-opinion-leader wallet |
| `sniper` 🎯 | A wallet that bought within the first 5 blocks of the token's first swap |
| `dev` 🛠️ | The wallet that created the token |

**One marker per bucket, on the side of the net flow.** Birdeye's volumes are
gross and leg-based, so a cohort that bought $9,000 and sold $2,000 in a bucket
gets one buy marker worth $7,000; one that bought and sold the same amount gets
none. The popup shows the net value and the number of wallets on that side.

**Bucket size.** The finest tracker bucket at least as wide as a candle that
keeps the window under 300 buckets (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1W).
A marker sits on the candle where its bucket opens.

**Range limits.** One request may span 30 days of second buckets, 60 days of
minute buckets, 90 days of hour buckets and 365 days of day or week buckets.
Longer windows are split into several requests, each two buckets short of the
limit, because Birdeye aligns buckets to its own grid. Pages of 50 buckets are
followed with `next_time_from`, up to 16 per window.

**KOL names.** With names on, `GET /token/v1/wallet-tags-tracker/details`
lists the KOL wallets in each bucket, and `GET /identity/v1/single` resolves
up to six of the most active to their labels (`KOL: slingoor` shows as
`slingoor`). A KOL marker names the wallets on its side of that bucket.

**Unsupported tokens.** Birdeye does not track wallet tags for core and very
large tokens (SOL, USDC, USDT, BONK). The editor says so; big trades still work.

## Big trades (Trades - Token Filtered By Volume)

`GET /defi/v3/token/txs-by-volume` returns swaps at or above a USD size inside
the window, 200 per request.

- **Auto size.** Starts near 1/400th of the window's USD volume, rounded to
  250, 500, 1K, 2.5K, 5K…. If more than 200 swaps clear it, the size goes up
  ×2.5 until the window fits one page; if fewer than 8 clear it, it comes down
  ÷5 once. At most four requests.
- **Fixed size.** The size you pick is used as is; if the window holds more
  than 200 such swaps it is raised the same way and the editor says so.
- **Round trips are hidden.** A buy and a sell by the same wallet within two
  minutes and within 15% of each other's size are dropped together and
  counted. At sizes above $1M on busy tokens nearly every swap is an
  arbitrage round trip.
- **Names.** With names on, the five biggest swaps' wallets are looked up in
  Wallet Identity (exchanges, market makers, searchers).

## Density and totals

The **density** control keeps each layer's biggest markers (Key moments 6,
Normal 14, All 60) and puts them back in time order. Markers that land within
half a second of clip time share one popup, which lists the two largest
layer-and-side lines in it.

The **result card** totals every event of each enabled layer, not just the
drawn ones: net flow for the wallet cohorts, buy and sell counts for big
trades.
