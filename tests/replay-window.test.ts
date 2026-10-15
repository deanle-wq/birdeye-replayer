import assert from "node:assert/strict";
import test from "node:test";
import {
  binEvents,
  defaultWalletTimeframe,
  PAD_BARS,
  walletActivity,
  walletReplayWindow,
} from "../src/lib/replay-window";
import type { LedgerEvent } from "../src/server/pnl/ledger";

const NOW = 1_800_000_000;

function event(kind: LedgerEvent["kind"], timestamp: number, quantity = 10, signature = `${kind}-${timestamp}`): LedgerEvent {
  return { signature, timestamp, kind, quantity, priceUsd: 1, valueUsd: quantity, exactExecution: kind === "buy" || kind === "sell" };
}

test("wallet window spans the wallet's own fills, not its transfers", () => {
  const activity = walletActivity({
    events: [
      event("transfer_in", NOW - 400 * 86_400),
      event("buy", NOW - 10 * 86_400),
      event("sell", NOW - 9 * 86_400, 10),
    ],
    holding: 0,
  });
  assert.deepEqual(activity, { firstTs: NOW - 10 * 86_400, lastTs: NOW - 9 * 86_400, holding: false });
});

test("an open position runs the replay to now; dust does not", () => {
  const events = [event("buy", NOW - 3_600, 1_000), event("sell", NOW - 1_800, 990)];
  assert.equal(walletActivity({ events, holding: 10 })?.holding, false);
  assert.equal(walletActivity({ events, holding: 11 })?.holding, true);
  const open = walletActivity({ events, holding: 500 })!;
  const range = walletReplayWindow(open, "1m", NOW);
  assert.equal(range.to, NOW);
});

test("default timeframe follows the wallet span, and padding is measured in bars", () => {
  const twoHours = { firstTs: NOW - 10 * 86_400, lastTs: NOW - 10 * 86_400 + 7_200, holding: false };
  assert.equal(defaultWalletTimeframe(twoHours, NOW), "1m");
  assert.equal(defaultWalletTimeframe({ ...twoHours, lastTs: twoHours.firstTs + 3 * 86_400 }, NOW), "15m");
  assert.equal(defaultWalletTimeframe({ ...twoHours, firstTs: NOW - 700 * 86_400 }, NOW), "1D");

  const range = walletReplayWindow(twoHours, "5m", NOW);
  assert.equal(range.from % 300, 0);
  assert.ok(twoHours.firstTs - range.from >= PAD_BARS * 300);
  assert.ok(twoHours.firstTs - range.from < (PAD_BARS + 1) * 300);
  assert.equal(range.to, twoHours.lastTs + PAD_BARS * 300);
});

test("a fill inside a bar Birdeye omitted snaps to the nearest drawn bar", () => {
  // 1m bars with 120 and 180 missing.
  const candles = [{ unixTime: 0 }, { unixTime: 60 }, { unixTime: 240 }, { unixTime: 300 }];
  const bins = binEvents(
    [event("buy", 130), event("sell", 230), event("buy", 30)],
    candles,
    "1m",
    { from: 0, to: 360 },
  );
  assert.deepEqual(bins.bars, [1, 2, 0]);
  assert.equal(bins.plotted, 3);
  assert.equal(bins.outside, 0);
});

test("events outside the range keep their order but are reported, transfers are never plotted", () => {
  const candles = [{ unixTime: 1_000 }, { unixTime: 1_060 }];
  const bins = binEvents(
    [event("transfer_in", 10), event("buy", 20), event("sell", 5_000), event("transfer_out", 1_010)],
    candles,
    "1m",
    { from: 1_000, to: 1_200 },
  );
  assert.deepEqual(bins.bars, [-1, -1, 2, 0]);
  assert.equal(bins.plotted, 0);
  assert.equal(bins.outside, 2);
});

test("a buy burst in the same bar cannot hide a sell marker", () => {
  const candles = [{ unixTime: 0 }, { unixTime: 60 }];
  const burst = Array.from({ length: 250 }, (_, index) => event("buy", 61, 1, `buy-${index}`));
  const bins = binEvents([...burst, event("sell", 62, 5)], candles, "1m", { from: 0, to: 120 });
  assert.equal(bins.fills.get(1)?.buy.length, 250);
  assert.equal(bins.fills.get(1)?.sell.length, 1);
  assert.equal(bins.plotted, 251);
});

test("sampled history widens to the Top Traders span; a full ledger does not", () => {
  const events = [event("buy", NOW - 5 * 86_400), event("sell", NOW - 4 * 86_400)];
  const hints = { firstTradeAt: NOW - 40 * 86_400, lastTradeAt: NOW - 2 * 86_400 };
  assert.equal(walletActivity({ events, holding: 0, ...hints })?.firstTs, NOW - 5 * 86_400);
  const sampled = walletActivity({ events, holding: 0, ...hints, widenToHints: true })!;
  assert.equal(sampled.firstTs, hints.firstTradeAt);
  assert.equal(sampled.lastTs, hints.lastTradeAt);
});
