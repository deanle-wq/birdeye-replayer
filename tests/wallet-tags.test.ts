import assert from "node:assert/strict";
import test from "node:test";
import { formatMultiple, walletRole, walletStory, walletTags } from "../src/lib/wallet-tags";
import type { LedgerEvent } from "../src/server/pnl/ledger";

const buy = (quantity: number, valueUsd: number): LedgerEvent => ({
  signature: `b${quantity}`, timestamp: 1, kind: "buy", quantity, priceUsd: valueUsd / quantity, valueUsd, exactExecution: true,
});
const sell = (quantity: number, valueUsd: number): LedgerEvent => ({
  signature: `s${quantity}`, timestamp: 2, kind: "sell", quantity, priceUsd: valueUsd / quantity, valueUsd, exactExecution: true,
});

test("the card numbers: invested, entry market cap, sold and the multiple", () => {
  // Matches the reference card: $12,283 in, +$198,971 PnL, nothing sold.
  const story = walletStory({
    investedUsd: 12_283, soldUsd: 0, totalUsd: 198_971, realizedUsd: 0, unrealizedUsd: 198_971,
    events: [buy(1_000_000, 12_283)], circulatingSupply: 50_230_000,
  });
  assert.equal(formatMultiple(story.multiple), "17x");
  assert.equal(Math.round(story.entryMarketCapUsd!), 616_975);
  assert.equal(story.avgSellPriceUsd, null);
  assert.equal(formatMultiple(1.43), "1.4x");
  assert.equal(formatMultiple(0.42), "0.42x");
  assert.equal(formatMultiple(null), null);
  assert.equal(formatMultiple(0.004), "<0.01x");
  // A loss larger than the buys has no honest multiple.
  assert.equal(formatMultiple(-0.4), null);
});

test("diamond hands and moonshot for a holder who never sold a 17x", () => {
  const story = walletStory({ investedUsd: 12_283, soldUsd: 0, totalUsd: 198_971, realizedUsd: 0, unrealizedUsd: 198_971, events: [buy(10, 12_283)] });
  assert.deepEqual(walletTags(story, { holding: true, currentPriceUsd: 1 }).map((tag) => tag.label), ["Moonshot", "Diamond hands"]);
});

test("paper hands when the price doubled after a full exit; rekt and bag holder on losses", () => {
  const paper = walletStory({ investedUsd: 1_000, soldUsd: 1_100, totalUsd: 100, realizedUsd: 100, unrealizedUsd: 0, events: [buy(100, 1_000), sell(100, 1_100)] });
  assert.equal(walletTags(paper, { holding: false, currentPriceUsd: 30 })[0]?.label, "Paper hands");
  const rekt = walletStory({ investedUsd: 1_000, soldUsd: 0, totalUsd: -900, realizedUsd: 0, unrealizedUsd: -900, events: [buy(100, 1_000)] });
  assert.deepEqual(walletTags(rekt, { holding: true, currentPriceUsd: 1 }).map((tag) => tag.label), ["Rekt", "Diamond hands"]);
  const bag = walletStory({ investedUsd: 1_000, soldUsd: 50, totalUsd: -600, realizedUsd: -10, unrealizedUsd: -590, events: [buy(100, 1_000)] });
  assert.ok(walletTags(bag, { holding: true, currentPriceUsd: 1 }).some((tag) => tag.label === "Bag holder"));
});

test("never more than two tags; the role falls back to trader", () => {
  const story = walletStory({ investedUsd: 200_000, soldUsd: 150_000, totalUsd: 2_500_000, realizedUsd: 50_000, unrealizedUsd: 2_450_000, events: [buy(10, 200_000)], buys: 300, sells: 100 });
  assert.equal(walletTags(story, { holding: true, currentPriceUsd: 1, birdeyeTags: ["sniper"] }).length, 2);
  assert.equal(walletRole(["smart_trader"]), "smart trader");
  assert.equal(walletRole([]), "trader");
});
