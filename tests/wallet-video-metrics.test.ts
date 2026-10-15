import assert from "node:assert/strict";
import test from "node:test";
import { selectOverlayEvents, tradeValueInUnit, walletTradeTotals, walletVideoMetrics } from "../src/lib/wallet-video-metrics";
import { calculateLedger } from "../src/server/pnl/ledger";
import type { LedgerEvent } from "../src/server/pnl/ledger";
import type { BoardRow } from "../src/server/services/analyze-token";

const row: BoardRow = {
  wallet: "wallet",
  tags: [],
  source: "birdeye-wac",
  realizedUsd: 1_000,
  unrealizedUsd: 4_000,
  totalUsd: 5_000,
  holding: 5,
  boughtUsd: 100,
  soldUsd: 100,
  buys: 1,
  sells: 1,
  avgBuyPrice: 10,
  avgSellPrice: 20,
};

const events: LedgerEvent[] = [
  { signature: "buy", timestamp: 1, kind: "buy", quantity: 10, priceUsd: 10, valueUsd: 100, exactExecution: true },
  { signature: "sell", timestamp: 2, kind: "sell", quantity: 5, priceUsd: 20, valueUsd: 100, exactExecution: true },
];

test("Birdeye summary metrics move with replay and land on final totals", () => {
  const midway = walletVideoMetrics({
    row,
    events,
    currentEvents: events.slice(0, 1),
    currentPrice: 12,
    finalPrice: 20,
    reveal: 0.5,
  });
  assert.equal(midway.realizedUsd, 0);
  assert.notEqual(midway.unrealizedUsd, row.unrealizedUsd);

  const final = walletVideoMetrics({
    row,
    events,
    currentEvents: events,
    currentPrice: 20,
    finalPrice: 20,
    reveal: 1,
  });
  assert.deepEqual(final, { realizedUsd: 1_000, unrealizedUsd: 4_000, totalUsd: 5_000 });
});

test("summary without trade events still counts up over chart time", () => {
  const midway = walletVideoMetrics({ row, events: [], currentEvents: [], currentPrice: 10, finalPrice: 20, reveal: 0.5 });
  assert.equal(midway.realizedUsd, 750);
  assert.equal(midway.unrealizedUsd, 3_000);
  assert.equal(midway.totalUsd, 3_750);
});

test("dense overlays preserve a visible buy then sell sequence", () => {
  const dense: LedgerEvent[] = [
    ...Array.from({ length: 20 }, (_, index) => ({ ...events[0]!, signature: `buy-${index}`, timestamp: index + 1 })),
    ...Array.from({ length: 20 }, (_, index) => ({ ...events[1]!, signature: `sell-${index}`, timestamp: index + 21 })),
  ];
  const selected = selectOverlayEvents(dense, 8);
  assert.deepEqual(selected.map((event) => event.kind), ["buy", "sell"]);
});

test("trade overlay converts consistently between USDC and SOL", () => {
  const event = { ...events[0]!, valueUsd: 300, settlementSymbol: "USDC" as const, settlementAmount: 300 };
  assert.equal(tradeValueInUnit(event, "USDC", 150), 300);
  assert.equal(tradeValueInUnit(event, "SOL", 150), 2);
});

test("audited clips mark the ledger per frame and close on the board total", () => {
  const ledger = calculateLedger(events, 20);
  const audited: BoardRow = {
    ...row,
    source: "audited-ledger",
    realizedUsd: ledger.realizedUsd,
    unrealizedUsd: ledger.unrealizedUsd + 7,
    totalUsd: ledger.totalUsd + 7,
    audit: {
      confidence: "high",
      reasons: [],
      birdeyeTotalUsd: row.totalUsd,
      deltaUsd: 0,
      reconciledQuantityDelta: 0,
      exactExecutionRatio: 1,
      unknownBasisRatio: 0,
      truncated: false,
      eventCount: events.length,
      spotPriceUsd: 21.4,
      ledger,
    },
  };
  const midway = walletVideoMetrics({ row: audited, events, currentEvents: events.slice(0, 1), currentPrice: 15, finalPrice: 20, reveal: 0.5 });
  assert.deepEqual(midway, { realizedUsd: 0, unrealizedUsd: 50, totalUsd: 50, avgCostUsd: 10 });
  const final = walletVideoMetrics({ row: audited, events, currentEvents: events, currentPrice: 20, finalPrice: 20, reveal: 1 });
  assert.equal(final.totalUsd, audited.totalUsd);
});

test("ledger clips total every buy and sell on screen, in either unit", () => {
  const audited = { ...row, audit: { truncated: false } } as unknown as BoardRow;
  const fills: LedgerEvent[] = [
    { ...events[0]!, valueUsd: 300, settlementSymbol: "SOL", settlementAmount: 2 },
    { ...events[0]!, signature: "buy-2", timestamp: 2, valueUsd: 150 },
    { ...events[1]!, timestamp: 3, valueUsd: 600 },
    { signature: "gift", timestamp: 4, kind: "transfer_in", quantity: 5, priceUsd: 99, valueUsd: 495, exactExecution: false },
  ];
  const midway = walletTradeTotals({ row: audited, events: fills, currentEvents: fills.slice(0, 2), reveal: 0.5, unit: "USDC", solPriceUsd: 150 });
  assert.deepEqual(midway, { bought: 450, sold: 0 });
  const final = walletTradeTotals({ row: audited, events: fills, currentEvents: fills, reveal: 1, unit: "SOL", solPriceUsd: 150 });
  assert.deepEqual(final, { bought: 3, sold: 4 });
});

test("Birdeye WAC clips land on Birdeye's cash-flow totals", () => {
  const midway = walletTradeTotals({ row, events, currentEvents: events.slice(0, 1), reveal: 0.5, unit: "USDC", solPriceUsd: 100 });
  assert.deepEqual(midway, { bought: 100, sold: 0 });
  const final = walletTradeTotals({ row, events, currentEvents: events, reveal: 1, unit: "SOL", solPriceUsd: 100 });
  assert.deepEqual(final, { bought: 1, sold: 1 });
});
