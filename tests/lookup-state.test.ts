import assert from "node:assert/strict";
import test from "node:test";
import { sameLookup, TimedCache } from "../src/lib/lookup-state";

const MINT = "EnAtbbo1AZWmuXA5PH1Gn4UgGpiTzzmaGbJpLWgjpump";
const OTHER = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

test("the address on screen locks the lookup; any other address unlocks it", () => {
  const loaded = { address: MINT, settled: true };
  assert.equal(sameLookup(MINT, loaded), true);
  assert.equal(sameLookup(`  ${MINT}  `, loaded), true, "pasted whitespace is not a new address");
  assert.equal(sameLookup(MINT.slice(0, -1), loaded), false, "one character off is a new lookup");
  assert.equal(sameLookup(OTHER, loaded), false);
  assert.equal(sameLookup(MINT.toLowerCase(), loaded), false, "base58 is case-sensitive");
  assert.equal(sameLookup("", loaded), false);
});

test("nothing loaded, sample data or unfinished work never blocks a lookup", () => {
  assert.equal(sameLookup(MINT, null), false);
  assert.equal(sameLookup(MINT, undefined), false);
  assert.equal(sameLookup(MINT, { address: MINT, demo: true }), false, "the sample does not block the real token");
  assert.equal(sameLookup(MINT, { address: MINT, settled: false }), false, "an interrupted audit can be rerun");
  assert.equal(sameLookup(MINT, { address: MINT }), true, "wallets have no background work, so they are settled");
});

test("token context cache serves repeats inside its window and refetches after", () => {
  let now = 1_000;
  const cache = new TimedCache<string>(5 * 60_000, () => now);
  assert.equal(cache.get(MINT), undefined);
  cache.set(MINT, "context");
  now += 4 * 60_000;
  assert.equal(cache.get(MINT), "context");
  assert.equal(cache.get(OTHER), undefined, "keys do not leak into each other");
  now += 2 * 60_000;
  assert.equal(cache.get(MINT), undefined, "stale prices are dropped");
});

test("a symbol that carries its own $ is not printed as $$", async () => {
  const { cleanSymbol } = await import("../src/lib/symbol");
  assert.equal(cleanSymbol("$WIF"), "WIF");
  assert.equal(cleanSymbol(" $$WIF "), "WIF");
  assert.equal(cleanSymbol("BONK"), "BONK");
  assert.equal(cleanSymbol("W$F"), "W$F", "only a leading $ is the UI's");
  assert.equal(cleanSymbol("$"), undefined, "nothing left means no symbol, so callers fall back");
  assert.equal(cleanSymbol(undefined), undefined);
});
