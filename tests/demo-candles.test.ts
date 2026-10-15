import assert from 'node:assert/strict';
import test from 'node:test';
import { demoAnalysis } from '../src/server/demo';

test('sample candles share Chart’s continuous price and varying wick profile', () => {
  const { candles, board, spotPriceUsd } = demoAnalysis();
  assert.equal(candles.length, 180);
  let green = 0;
  let red = 0;
  const upperWicks = new Set<number>();
  candles.forEach((candle,index) => {
    assert.ok(candle.h >= Math.max(candle.o,candle.c));
    assert.ok(candle.l <= Math.min(candle.o,candle.c) && candle.l > 0);
    assert.ok(candle.unixTime % 3_600 === 0);
    if (index > 0) assert.equal(candle.o,candles[index-1]!.c);
    if (candle.c >= candle.o) green++; else red++;
    upperWicks.add(Math.round((candle.h / Math.max(candle.o,candle.c) - 1)*10_000));
  });
  assert.ok(green > 30 && red > 30, 'sample has varied trading candles, not a uniform sine wave');
  assert.ok(upperWicks.size > 40);
  assert.equal(spotPriceUsd,candles.at(-1)!.c);
  for (const row of board.filter(row=>row.audit)) {
    assert.equal(row.totalUsd,row.audit!.ledger.totalUsd);
  }
});
