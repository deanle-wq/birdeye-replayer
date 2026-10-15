# PnL methodology

## Two layers, two jobs

The fast layer is Birdeye Wallet PnL with `pnl_method=wac`. It makes a large
leaderboard affordable and provides current holding, aggregate cash flow,
realized PnL, unrealized PnL, and average prices.

The audit layer independently reconstructs a selected wallet/token pair. It is
not used blindly for every candidate because complete historical reads are the
expensive part of the product.

## Canonical event construction

For each transaction signature:

1. Sum every wallet token-account balance change for the target mint.
2. If the signature is present in decoded trader trades, classify the net
   movement as a buy or sell.
3. Derive execution price from `volume_usd / target-token quantity`.
4. If execution price is unavailable, use the token leg's indexed price, then
   the closest OHLCV close. A decoded swap with no USD price at all is still a
   swap: it keeps its buy/sell classification and takes the OHLCV mark, rather
   than becoming unknown-basis transfer inventory.
5. If no decoded trade matches the signature, classify it as a transfer.

Balance changes are read from 2021-01-01, not from Top Traders'
`firstTradeUnixTime`: that timestamp is not scoped to the token (a BONK wallet
reported a first trade three months before BONK existed), and a transfer that
arrived before the first swap must still be in the ledger.

The balance change controls quantity. This is important on routed swaps: a
router can emit several inner swaps, but the wallet has one net token balance
change. Counting every inner leg as a wallet fill can multiply the position.

## Weighted-average-cost ledger

For a confirmed buy:

```text
paid quantity += bought quantity
cost basis    += execution USD
cash invested += execution USD
```

For a confirmed sell:

```text
average cost  = remaining paid basis / remaining paid quantity
realized PnL += confirmed proceeds - average cost × paid quantity sold
```

For an incoming transfer, quantity increases but cost basis does not. The
inventory remains “unknown basis” and is excluded from unrealized PnL.

For an outgoing transfer, inventory and its proportional basis leave the
wallet, but the ledger does not invent sale proceeds. The removed basis is
reported as unresolved. A future product policy may estimate an exchange exit,
but that estimate must remain visually distinct from confirmed PnL.

```text
unrealized PnL = paid quantity still held × spot price - remaining paid basis
total PnL      = confirmed realized PnL + confirmed unrealized PnL
```

## Confidence grading

High confidence requires all of the following:

- no endpoint or configured event truncation;
- at least 95% of traded quantity has an execution-derived price;
- unknown-basis ratio is at most 5%;
- reconstructed quantity is within 1% of Birdeye's reported holding.

Medium confidence permits 75% execution coverage, 20% unknown basis, and 5%
quantity drift. Everything else is low confidence.

## Why results can differ from Birdeye aggregate PnL

- accounting method (`net_cash` versus WAC);
- decoded-trade coverage for a venue or router;
- transfers included as buys or sells by one system but not the other;
- unknown cost basis from airdrops, treasury distributions, or linked wallets;
- Token-2022 scaled UI amounts;
- history truncated by offset, time range, or product plan;
- use of candle marks instead of execution price;
- current-price timing.

The dashboard therefore shows both the audit delta and the confidence evidence.
A large delta is a prompt to inspect the ledger, not automatically proof that
one provider is wrong.

## Video replay

The video replays the same ledger the board audit grades. Each frame runs
`calculateLedger` over the events up to that candle, marked to that frame's
price, so realized PnL moves only on sells and unrealized follows the chart.
The closing frame shows the row's audited totals, which are marked at the spot
price used by the board.

Invested and Sold are gross cash flow: the summed value of every buy and every
sell up to the frame, transfers excluded. Sold therefore includes proceeds from
unknown-basis inventory, which the ledger's `soldUsd` (confirmed proceeds only)
leaves out; the two answer different questions.

### Card vocabulary

| Term | Definition |
|---|---|
| Invested | Gross USD of buys |
| Sold | Gross USD of sells |
| Multiple (`17x`) | (Invested + total PnL) / Invested. Hidden when nothing was bought, or when the loss exceeds Invested (transfers brought basis in, so no honest multiple exists) |
| Entry MC | Average buy price × current circulating supply from Token Market Data. Approximate for tokens whose supply changed since the wallet bought; shown as an average entry price when supply is unknown |

The average buy price comes from the replayed fills on ledger clips, and from
Birdeye's `avg_buy_cost` when the clip is sampled or inferred, because a sample
cannot average to the truth.

### Tags

The result card shows at most two tags, first match wins. Each is a plain
reading of numbers already on the card:

| Tag | Rule |
|---|---|
| 🚀 Moonshot | Multiple ≥ 10x |
| 💀 Rekt | Multiple ≤ 0.2x |
| 📤 Sent out | Holds nothing, sold at most 1% of Invested, and transfers out moved ≥ 90% of the tokens it received: the cost left with them, so PnL lands on $0 |
| 💎 Diamond hands | Still holding and sold at most 1% of Invested |
| 🧻 Paper hands | Fully exited, and today's price is at least 2× the average sell |
| 💰 Took profits | Realized PnL > 0 with sells |
| 🐣 Early bird | Entry MC ≤ 10% of today's market cap |
| 🐋 Whale | Invested ≥ $100K |
| 🎒 Bag holder | Still holding, unrealized loss, multiple < 0.5x |
| 🎰 Degen | 200 or more trades |
| 🎯 Sniper | Birdeye tags the wallet as a sniper |

Rows that cannot be read in full (above `AUDIT_MAX_TRADES`, or a ledger that hit
the event ceiling) keep Birdeye WAC as the number. Their clip derives timing
from the trade sample and lands on the WAC totals; the frame footer reads
`ESTIMATED PNL PATH` instead of `LEDGER PNL`.
