import assert from "node:assert/strict";
import test from "node:test";
import {
  candleIndexAtOrBefore,
  coarsenCandles,
  expectedCandleCount,
  MAX_REPLAY_CANDLES,
} from "../src/lib/replay-timeframe";
import type { BirdeyeCandle } from "../src/server/birdeye/types";

const candles: BirdeyeCandle[] = [
  { unixTime: 0, o: 10, h: 13, l: 9, c: 12, v: 2, type: "1m" },
  { unixTime: 60, o: 12, h: 14, l: 8, c: 9, v: 3, type: "1m" },
  { unixTime: 120, o: 9, h: 11, l: 7, c: 10, v: 4, type: "1m" },
  { unixTime: 300, o: 10, h: 12, l: 10, c: 11, v: 5, type: "1m" },
];

test("a fill inside a candle belongs to that candle, not the next one", () => {
  assert.equal(candleIndexAtOrBefore(candles, -1), -1);
  assert.equal(candleIndexAtOrBefore(candles, 0), 0);
  assert.equal(candleIndexAtOrBefore(candles, 59), 0);
  assert.equal(candleIndexAtOrBefore(candles, 60), 1);
  assert.equal(candleIndexAtOrBefore(candles, 119), 1);
  assert.equal(candleIndexAtOrBefore(candles, 300), 3);
});

test("wider OHLCV keeps first open, extrema, last close and summed volume", () => {
  const result = coarsenCandles(candles, "5m");
  assert.deepEqual(result, [
    { unixTime: 0, o: 10, h: 14, l: 7, c: 10, v: 9, type: "5m" },
    { unixTime: 300, o: 10, h: 12, l: 10, c: 11, v: 5, type: "5m" },
  ]);
  assert.equal(candles[0]?.v, 2);
});

test("full-history candle limit includes both ends", () => {
  assert.equal(expectedCandleCount(0, 60, "1m"), 2);
  assert.equal(expectedCandleCount(0, MAX_REPLAY_CANDLES * 60, "1m"), MAX_REPLAY_CANDLES + 1);
});
