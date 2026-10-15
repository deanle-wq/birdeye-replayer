import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_FORMATS, type Rect, type VideoShape } from '../src/lib/frame-kit';
import { walletCardLayout, walletResultLayout } from '../src/lib/wallet-card-layout';

for (const shape of Object.keys(VIDEO_FORMATS) as VideoShape[]) {
  test(`${shape}: identity, chart, callout and PnL stay in their own regions`, () => {
    const L = walletCardLayout(shape);
    const inside = (inner: Rect, outer: Rect) => {
      assert.ok(inner.w > 0 && inner.h > 0);
      assert.ok(inner.x >= outer.x && inner.y >= outer.y);
      assert.ok(inner.x + inner.w <= outer.x + outer.w);
      assert.ok(inner.y + inner.h <= outer.y + outer.h);
    };
    inside(L.card, { x: 0, y: 0, w: L.w, h: L.h });
    const regions = [L.header, L.plot, L.callout, L.summary];
    for (const R of regions) inside(R, L.card);
    for (let index = 1; index < regions.length; index++) {
      assert.ok(regions[index - 1]!.y + regions[index - 1]!.h < regions[index]!.y);
    }
    assert.ok(L.plot.h >= 400 * L.u, 'chart remains readable in the shortest format');
    assert.ok(L.footerY > L.card.y + L.card.h && L.footerY < L.h);
  });
}

for (const shape of Object.keys(VIDEO_FORMATS) as VideoShape[]) {
  test(`${shape}: result chart precedes figures without overlapping the header or footer`, () => {
    const L = walletResultLayout(shape);
    const regions = [L.header, L.hero, L.plot, L.stats, L.footer];
    for (const R of regions) {
      assert.ok(R.w > 0 && R.h > 0);
      assert.ok(R.x >= L.card.x && R.y >= L.card.y);
      assert.ok(R.x + R.w <= L.card.x + L.card.w);
      assert.ok(R.y + R.h <= L.card.y + L.card.h);
    }
    for (let index = 1; index < regions.length; index++) {
      assert.ok(regions[index - 1]!.y + regions[index - 1]!.h < regions[index]!.y);
    }
    assert.ok(L.plot.h >= 240 * L.u, 'chart keeps enough height in every export ratio');
    assert.deepEqual(L.card, walletCardLayout(shape).card, 'outro covers exactly the replay surface');
  });
}
