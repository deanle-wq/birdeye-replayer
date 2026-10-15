import assert from 'node:assert/strict';
import test from 'node:test';
import { walletPriceReplay } from '../src/lib/wallet-price-replay';
import type { BirdeyeCandle } from '../src/server/birdeye/types';

const candle = (close: number, index: number): BirdeyeCandle => ({ unixTime: index * 60, o: close - 1, c: close, h: close + 2, l: close - 2, v: 1, type: '1m' });

test('price begins at the first observed close, passes every close and ends on the final close', () => {
  const candles = [candle(100, 0), candle(120, 1), candle(90, 2)];
  assert.equal(walletPriceReplay(candles, 0).currentPrice, 100);
  assert.equal(walletPriceReplay(candles, .25).currentPrice, 112.5);
  assert.equal(walletPriceReplay(candles, .5).currentPrice, 120);
  assert.equal(walletPriceReplay(candles, 1).currentPrice, 90);
});

test('future extremes cannot flatten the observed price chart or leak into the forming wick', () => {
  const candles = [candle(100, 0), { ...candle(110, 1), h: 1_000_000 }, candle(10_000_000, 2)];
  const frame = walletPriceReplay(candles, .25);
  assert.ok(frame.currentPrice >= 100 && frame.currentPrice <= 110);
  assert.equal(frame.formingHigh, 109);
  assert.equal(frame.formingLow, frame.currentPrice);
  assert.ok(frame.high < 120);
  assert.ok(frame.low > 90);
});

test('a departing extremum eases out of the vertical range without a one-frame jump', () => {
  const candles = Array.from({ length: 90 }, (_, index) => candle(index === 0 ? 200 : 100, index));
  const at = (exact: number) => walletPriceReplay(candles, exact / 89, 64);
  assert.ok(Math.abs(at(63 + 1e-6).high - at(63 - 1e-6).high) < .001);
  assert.ok(Math.abs(at(64 + 1e-6).high - at(64 - 1e-6).high) < .001);
});

test('flat and sub-cent prices keep a finite, positive scale', () => {
  for (const price of [0, 1e-12, 100]) {
    const frame = walletPriceReplay([candle(price, 0), candle(price, 1)], .5);
    assert.ok(Number.isFinite(frame.low) && Number.isFinite(frame.high));
    assert.ok(frame.high > frame.low);
  }
});

test('smooth line preserves every close and cannot overshoot between samples', () => {
  const candles = [100, 101, 99, 110, 109, 80].map(candle);
  for (let bar = 0; bar < candles.length - 1; bar++) {
    for (let step = 0; step <= 20; step++) {
      const value = walletPriceReplay(candles, (bar + step / 20) / (candles.length - 1)).currentPrice;
      assert.ok(value >= Math.min(candles[bar]!.c,candles[bar+1]!.c) - 1e-9);
      assert.ok(value <= Math.max(candles[bar]!.c,candles[bar+1]!.c) + 1e-9);
    }
  }
});

test('candles share the chart feature open-to-close indexing and reveal only a forming body', async () => {
  const { walletCandleReplay } = await import('../src/lib/wallet-price-replay');
  const candles = [{ ...candle(120, 0), o: 100, h: 1_000, l: 20 }, { ...candle(90, 1), o: 120 }];
  assert.equal(walletCandleReplay(candles, 0).currentPrice, 100);
  const forming = walletCandleReplay(candles, .25);
  assert.equal(forming.currentPrice, 110);
  assert.equal(forming.closedBars, 0);
  assert.ok(forming.high < 130, 'the forming candle does not reveal its future wick');
  const closed = walletCandleReplay(candles, .5);
  assert.equal(closed.currentPrice, 120);
  assert.equal(closed.closedBars, 1);
  assert.ok(closed.high >= 1_000, 'the settled candle uses actual OHLC without shortening its wick');
  assert.equal(walletCandleReplay(candles, 1).currentPrice, 90);
  assert.equal(walletCandleReplay(candles, 1).closedBars, 2);
});

test('candle spacing stays fixed from the first frame through the replay', async () => {
  const { walletCandleReplay } = await import('../src/lib/wallet-price-replay');
  const candles = Array.from({ length: 180 }, (_, index) => candle(100 + index, index));
  for (const progress of [0, .02, .1, .5, .9, 1]) {
    assert.equal(walletCandleReplay(candles,progress,64).visibleCount,64);
    assert.equal(walletPriceReplay(candles,progress,64).visibleCount,64);
  }
});
