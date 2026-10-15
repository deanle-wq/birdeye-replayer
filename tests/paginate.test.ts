import assert from "node:assert/strict";
import test from "node:test";
import { crawlOffsetWindows } from "../src/server/birdeye/paginate";

test("splits a time range instead of accepting the offset ceiling as complete", async () => {
  const calls: Array<[number, number, number]> = [];
  const result = await crawlOffsetWindows({
    from: 1,
    to: 4,
    limit: 2,
    maxOffset: 4,
    key: (item: { id: string }) => item.id,
    fetchPage: async (from, to, offset, limit) => {
      calls.push([from, to, offset]);
      const dense = from === 1 && to === 4;
      const available = dense ? 8 : 2;
      const items = Array.from({ length: Math.min(limit, Math.max(0, available - offset)) }, (_, i) => ({
        id: `${from}:${to}:${offset + i}`,
      }));
      return { items, hasNext: offset + items.length < available };
    },
  });
  assert.equal(result.truncated, false);
  assert.ok(calls.some(([from, to]) => from === 1 && to === 2));
  assert.ok(calls.some(([from, to]) => from === 3 && to === 4));
});

test("prefetches known offset pages without changing pagination results", async () => {
  const offsets: number[] = [];
  const result = await crawlOffsetWindows({
    from: 1,
    to: 2,
    limit: 2,
    maxOffset: 10,
    prefetchPages: 3,
    key: (item: { id: number }) => String(item.id),
    fetchPage: async (_from, _to, offset) => {
      offsets.push(offset);
      const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const items = all.slice(offset, offset + 2);
      return { items, hasNext: offset + items.length < all.length };
    },
  });

  assert.deepEqual(new Set(offsets), new Set([0, 2, 4]));
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(result.truncated, false);
});
