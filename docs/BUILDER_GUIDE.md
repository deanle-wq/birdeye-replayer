# Building on Birdeye Data: what this repo is for

Birdeye Replayer's PnL replay is a reference build. Fork it to ship a wallet PnL board, a ledger
audit or a shareable PnL video on the Birdeye Data API. This page covers what
Birdeye Data handles for you, what it costs and where to extend it.

## What Birdeye Data handles for you

| Concern | Building from raw on-chain transactions | With Birdeye Data | What a builder saves |
|---|---|---|---|
| Price candles | Pick a pool, page its swaps and price each bar yourself: thousands of reads per chart window | `GET /defi/v3/ohlcv`: one request per 5,000 candles, 1m to 1D | The hardest subsystem disappears |
| Trader discovery | Scan holders, then read every wallet's full history before you can rank anyone | Top Traders × 6 ranking lenses + Wallet PnL Multiple (WAC) | A ranked board in seconds |
| One wallet's fills | Decode every venue's instructions, price from pool balance deltas, convert SOL to USD with an outside feed | Wallet Balance Change (quantity) joined to Token Transactions V3 with `owner` (USD-priced) by signature | No decoders, no price feed |
| PnL accounting | Write a ledger from scratch | Birdeye WAC baseline, plus this repo's conservative ledger with a confidence grade | Fast path and audit path from one provider |
| Wallet names | Maintain your own label set | `POST /identity/v1/multiple` (not wired yet) | See "Extend" |
| Wallet-first entry | Enumerate a wallet's token accounts, price every swap | `POST /wallet/v2/pnl/details` + `GET /wallet/v2/current-net-worth` | A wallet's whole token history and PnL in two calls |
| Cost visibility | Count your own calls | Per-request CU meter built into the UI and the CLI | Cost is visible from the first call |
| Video | Screenshot a charting library and layer DOM labels | One pure canvas renderer shared by preview and export, sound mixed in, 5–300 s, 16:9 / 9:16 / 1:1 at 1080p | The exported frames match the preview exactly |

## Measured cost

BONK, measured with the in-app meter (board 2026-10-09, audit 2026-10-08). CU
values come from Birdeye's
[published compute-unit table](https://data.birdeye.so/docs/guides/what-is-compute-unit-cost.md).

| Step | Requests | CU |
|---|---:|---:|
| Board (6 Top Traders lenses, Wallet PnL Multiple, OHLCV, price, metadata, market data) | 12 | 894 |
| Ledger audit of the leading wallet (17 balance-change pages, 48 trade buckets, OHLCV) | 66 | 821 |
| **One full analysis** | **78** | **1,715** |

Opening a wallet's video builds its full ledger. A 68-trade wallet took
32 requests, 389 CU and about 6 s (`npm run audit -- <mint> <wallet>` prints
the same breakdown in a terminal). The modal prints each replay's requests and
CU.

Prices used by the meter:

| Endpoint | CU |
|---|---|
| `/defi/v2/tokens/top_traders` | 30 |
| `/wallet/v2/pnl/multiple` | ceil(30 × wallets^0.8) |
| `/wallet/v2/balance-change` | 10 |
| `/defi/v3/token/txs` | 12 |
| `/defi/v3/ohlcv` | 25 / 30 / 40 / 75 / 100 by candles returned |
| `/defi/price`, `/defi/v3/token/meta-data/single` | 3 |
| `/defi/v3/token/meta-data/multiple` | ceil(3 × mints^0.8) |
| `/defi/v3/token/market-data` | 10 |
| `/wallet/v2/pnl/details`, `/wallet/v2/current-net-worth`, `/identity/v1/single` | 30 each |

Wallet mode, backtested on five live wallets (2026-10-09,
`npm run backtest:wallet`): a wallet page costs 90 CU plus up to 165 CU of
token metadata per 100 tokens, and opening one of its tokens adds about
70–160 CU for the chart before the replay itself.

## Endpoint traps (verified live)

- Token Transactions V3 with `owner` and **no** time bounds returns zero rows
  on a busy token. Bounds are required, and their span is capped at 30 days.
  Read 29-day buckets, and only those that contain a balance change.
- `tx_type=buy` and `tx_type=sell` filter by side together with `owner`. The
  sampled replay reads one page of each, so buys never crowd out sells.
- Top Traders `firstTradeUnixTime` is not scoped to the token. One BONK wallet
  reported a first trade three months before BONK existed. Clamp it to the
  token's chart before using it.
- Wallet PnL Multiple can omit a wallet entirely. A missing row means "not
  answered", not $0.

## Extend

Ordered by value for a demo.

1. **Wallet names.** Batch the board through `/identity/v1/multiple`
   (ceil(30 × n^0.8) CU, up to 100 addresses; needs a Premium plan) and show
   exchange and KOL labels.
2. **Production guards.** Use a shared cache, a job queue for heavy wallets,
   and CU ceilings per IP, per wallet and per day, with a pre-flight cost
   check before expensive work.
3. **Voice-over.** Browser speech synthesis cannot be captured into the
   export. A narrated result card needs a server-side TTS call mixed into the
   soundtrack buffer.

## Design system

- **Brand.** The Birdeye Data brand kit is copied in unchanged:
  `src/styles/birdeye-data-tokens.css`, Geist and Geist Mono in
  `public/brand/fonts`, logos in `public/brand/logos`. The app uses the
  terminal profile: black ground, 1px borders, no drop shadows, and green
  only as an accent.
- **Components.** [shadcn/ui](https://ui.shadcn.com) on Radix: Dialog, Tabs,
  ToggleGroup, Switch, Slider, Tooltip, Button, Badge and Input. Its theme
  variables map onto the Birdeye tokens in `globals.css`, and every shadow
  token is set to none.
- **Icons.** [Phosphor](https://phosphoricons.com).
- **Video.** Follows the social-channel rules: Geist only, with the corner
  glow, grain and glass chips of the campaign art. Red appears only for losses
  and sells, always paired with a sign, a label, or a B/S badge.

## Video architecture

| Module | Job |
|---|---|
| `src/lib/video-scene.ts` | Pure timing: timeline, fill bursts, popups, sound cues, number formats. Unit tested |
| `src/lib/video-frame.ts` | `drawVideoFrame(ctx, seconds, scene)`, which draws one frame. Preview and export call the same function |
| `src/lib/video-audio.ts` | Synthesised sound effects. The same graph runs live (`AudioContext`) and offline (`OfflineAudioContext`) |
| `src/lib/wallet-video.ts` | Frame-by-frame mediabunny export with an AAC or Opus track |
| `src/lib/replay-window.ts` | The wallet's own chart window, and bar placement that never drops a fill |
| `src/lib/wallet-tags.ts` | Card vocabulary: invested, entry market cap, sold, the multiple and achievement tags. Unit tested |
| `src/lib/token-logo.ts` | Loads the token logo with CORS (direct, then an image proxy) so the canvas stays exportable |
