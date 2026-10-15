import assert from "node:assert/strict";
import test from "node:test";
import { buildLedgerEvents, buildTradeReplayEvents, calculateLedger } from "../src/server/pnl/ledger";
import type { BirdeyeBalanceChange, BirdeyeTrade } from "../src/server/birdeye/types";

const MINT = "TokenMint111111111111111111111111111111111";

function change(signature: string, timestamp: number, before: number, after: number): BirdeyeBalanceChange {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    pre_balance: String(before * 1_000_000),
    post_balance: String(after * 1_000_000),
    amount: String((after - before) * 1_000_000),
    token_account: "ata",
    token_info: { address: MINT, decimals: 6 },
  };
}

function trade(signature: string, timestamp: number, quantity: number, usd: number, index = 0): BirdeyeTrade {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    ins_index: index,
    volume_usd: usd,
    source: "test_dex",
    from: { address: MINT, ui_amount: quantity },
  };
}

test("uses wallet balance delta once even when a routed swap has duplicate legs", () => {
  const events = buildLedgerEvents({
    mint: MINT,
    balanceChanges: [change("buy", 1, 0, 10)],
    trades: [trade("buy", 1, 10, 100, 1), trade("buy", 1, 10, 100, 1)],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.quantity, 10);
  assert.equal(events[0]?.valueUsd, 100);
});

test("computes weighted-average realized and unrealized PnL", () => {
  const events = buildLedgerEvents({
    mint: MINT,
    balanceChanges: [change("buy", 1, 0, 10), change("sell", 2, 10, 6)],
    trades: [trade("buy", 1, 10, 100), trade("sell", 2, 4, 60)],
  });
  const result = calculateLedger(events, 20);
  assert.equal(result.quantity, 6);
  assert.equal(result.costBasisUsd, 60);
  assert.equal(result.realizedUsd, 20);
  assert.equal(result.unrealizedUsd, 60);
  assert.equal(result.totalUsd, 80);
});

test("does not turn transferred inventory into profit", () => {
  const events = buildLedgerEvents({
    mint: MINT,
    balanceChanges: [change("gift", 1, 0, 10), change("sell", 2, 10, 0)],
    trades: [trade("sell", 2, 10, 1_000)],
  });
  const result = calculateLedger(events, 100);
  assert.equal(result.realizedUsd, 0);
  assert.equal(result.totalUsd, 0);
  assert.equal(result.unknownBasisRatio, 1);
});

test("outgoing transfers do not invent sale proceeds", () => {
  const events = buildLedgerEvents({
    mint: MINT,
    balanceChanges: [change("buy", 1, 0, 10), change("send", 2, 10, 0)],
    trades: [trade("buy", 1, 10, 100)],
  });
  const result = calculateLedger(events, 15);
  assert.equal(result.realizedUsd, 0);
  assert.equal(result.quantity, 0);
  assert.equal(result.unresolvedBasisOutUsd, 100);
});

test("builds a replay event with the actual SOL settlement leg", () => {
  const events = buildTradeReplayEvents([{
    tx_hash: "swap",
    block_unix_time: 100,
    side: "sell",
    volume_usd: 150,
    from: { address: MINT, symbol: "TOKEN", ui_change_amount: -10 },
    to: {
      address: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      ui_change_amount: 1.25,
    },
  }], MINT);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "sell");
  assert.equal(events[0]?.settlementSymbol, "SOL");
  assert.equal(events[0]?.settlementAmount, 1.25);
  assert.equal(events[0]?.valueUsd, 150);
});

test("a decoded swap without a USD price stays a buy and uses the fallback mark", () => {
  const events = buildLedgerEvents({
    mint: MINT,
    balanceChanges: [change("unpriced", 1, 0, 10)],
    trades: [{ tx_hash: "unpriced", block_unix_time: 1, ins_index: 0, to: { address: MINT, ui_amount: 10 } }],
    fallbackPrice: () => 4,
  });
  assert.equal(events[0]?.kind, "buy");
  assert.equal(events[0]?.priceUsd, 4);
  assert.equal(events[0]?.exactExecution, false);
  assert.equal(calculateLedger(events, 5).totalUsd, 10);
});
