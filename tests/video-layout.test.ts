import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_FORMATS, type VideoShape } from '../src/lib/frame-kit';
import { resultCardLayout, videoLayout } from '../src/lib/video-layout';

test('video regions fit every export format and reserve a separate chart, callout and result', () => {
  for (const shape of Object.keys(VIDEO_FORMATS) as VideoShape[]) {
    const L = videoLayout(shape);
    for (const R of [L.header, L.plot, L.callout, L.summary]) {
      assert.ok(R.w > 200 && R.h > 60, `${shape}: usable region`);
      assert.ok(R.x >= L.card.x && R.y >= L.card.y, `${shape}: inside top/left`);
      assert.ok(R.x + R.w <= L.card.x + L.card.w, `${shape}: inside right`);
      assert.ok(R.y + R.h <= L.card.y + L.card.h, `${shape}: inside bottom`);
    }
    assert.ok(L.plot.y + L.plot.h < L.callout.y, `${shape}: callout cannot cover chart`);
    assert.ok(L.callout.y + L.callout.h < L.summary.y, `${shape}: result cannot cover chart or callout`);
    assert.ok(L.footerY > L.card.y + L.card.h && L.footerY < L.h, `${shape}: footer remains visible`);
  }
});

test('result card auto-layout keeps every block ordered and inside every export format', () => {
  for (const shape of Object.keys(VIDEO_FORMATS) as VideoShape[]) {
    const L = videoLayout(shape);
    for (const hasPills of [true, false]) {
      const result = resultCardLayout(L.card, shape, L.u, 1, hasPills);
      const regions = [result.header, result.change, ...(result.pills ? [result.pills] : []), result.divider, result.metrics, result.sparkline, result.footer];
      for (const region of regions) {
        assert.ok(region.x >= result.card.x && region.y >= result.card.y, `${shape}: result block starts inside card`);
        assert.ok(region.x + region.w <= result.card.x + result.card.w, `${shape}: result block ends inside card`);
        assert.ok(region.y + region.h <= result.card.y + result.card.h, `${shape}: result block fits vertically`);
      }
      for (let index = 1; index < regions.length; index += 1) {
        assert.ok(regions[index - 1]!.y + regions[index - 1]!.h < regions[index]!.y, `${shape}: result blocks never overlap`);
      }
    }
  }
});

import { lineReplay } from '../src/lib/line-replay';
import type { BirdeyeCandle } from '../src/server/birdeye/types';

test('line replay includes the opening price and every close, and holds the real result', () => {
  const candles = [{ o: 10, c: 12 }, { o: 12, c: 8 }] as BirdeyeCandle[];
  assert.deepEqual(lineReplay(candles, 0).values, [10, 12, 8]);
  assert.equal(lineReplay(candles, 0).current, 10);
  assert.equal(lineReplay(candles, .5).current, 12);
  assert.equal(lineReplay(candles, 1).current, 8);
  assert.equal(lineReplay(candles, 1.5).current, 8);
});
