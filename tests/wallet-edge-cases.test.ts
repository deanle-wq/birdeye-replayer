import assert from "node:assert/strict";
import test from "node:test";
import { walletStory, walletTags } from "../src/lib/wallet-tags";
import { upstreamError } from "../src/server/api-key";
import { BirdeyeError } from "../src/server/birdeye/client";
import type { LedgerEvent } from "../src/server/pnl/ledger";
import { settledHolding } from "../src/server/services/wallet-ledger";
import { allTimeHistoryFailed } from "../src/server/services/wallet-portfolio";

const event = (kind: LedgerEvent["kind"], quantity: number, valueUsd = 0): LedgerEvent => ({
  signature: `${kind}${quantity}`, timestamp: 1, kind, quantity, priceUsd: quantity > 0 ? valueUsd / quantity : 0, valueUsd, exactExecution: true,
});

// $CAPE, wallet HCL7E…cz1d (2026-10-15): four pump.fun buys for $2,849, then
// fifteen transfers of 7–8M tokens out within four minutes, nothing sold.
const BUYS = [event("buy", 103_060_403.855651, 2_546.58), event("buy", 3_094_752.401838, 100.84), event("buy", 2_920_894.246011, 100.84), event("buy", 2_866_904.237191, 100.84)];
const OUT = [8_075_769.17205, 7_386_639.690985, 6_966_571.512025, 7_949_703.370951, 7_118_938.811194, 8_033_142.606211, 7_674_142.273346, 6_830_529.280623, 7_759_093.088955, 7_690_467.341114, 7_385_279.268671, 6_994_989.222584, 7_424_731.515777, 7_822_277.147539, 6_830_680.438666].map((quantity) => event("transfer_out", quantity));

test("float dust after many transfers is not a holding; a real position is kept", () => {
  assert.equal(settledHolding(2.7939677238464355e-8, [...BUYS, ...OUT]), 0);
  assert.equal(settledHolding(-3e-9, BUYS), 0);
  assert.equal(settledHolding(1_250_000, BUYS), 1_250_000);
  assert.equal(settledHolding(0.5, [event("buy", 2, 10)]), 0.5, "small trades keep small positions");
});

test("a wallet that sent its bag away reads Sent out, never Diamond hands", () => {
  const story = walletStory({ investedUsd: 2_849.1, soldUsd: 0, totalUsd: 0, realizedUsd: 0, unrealizedUsd: 0, events: [...BUYS, ...OUT] });
  assert.ok(story.sentOutShare > 0.99);
  assert.deepEqual(walletTags(story, { holding: false, currentPriceUsd: 0.00003 }).map((tag) => tag.label), ["Sent out"]);
  // The same buys still held: diamond hands, no Sent out.
  const held = walletStory({ investedUsd: 2_849.1, soldUsd: 0, totalUsd: 4_000, realizedUsd: 0, unrealizedUsd: 4_000, events: BUYS });
  assert.equal(held.sentOutShare, 0);
  assert.deepEqual(walletTags(held, { holding: true, currentPriceUsd: 0.00006 }).map((tag) => tag.label), ["Diamond hands"]);
});

test("only Birdeye's own failures fall back to 90 days; key and rate errors surface", () => {
  assert.equal(allTimeHistoryFailed(new BirdeyeError('Birdeye 400: {"success":false,"message":"Internal server error"}', 400, "/wallet/v2/pnl/details")), true);
  assert.equal(allTimeHistoryFailed(new BirdeyeError("Birdeye 502: bad gateway", 502, "/wallet/v2/pnl/details")), true);
  for (const status of [401, 403, 429]) assert.equal(allTimeHistoryFailed(new BirdeyeError(`Birdeye ${status}`, status, "/x")), false);
  assert.equal(allTimeHistoryFailed(new Error("network down")), false);
});

test("a Birdeye error reads as a sentence, not raw JSON", async () => {
  const response = upstreamError(new BirdeyeError('Birdeye 400: {"success":false,"message":"Internal server error"}', 400, "/wallet/v2/pnl/details"), "Wallet lookup failed.");
  assert.equal(response.status, 502);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "Wallet lookup failed: Birdeye Data returned an error (Internal server error). Try again in a moment.");
  assert.equal(upstreamError(new BirdeyeError("Birdeye 429", 429, "/x"), "x").status, 429);
});
