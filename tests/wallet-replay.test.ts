import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { walletReplay } from "../src/server/services/wallet-replay";

const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const T0 = 1_700_000_000;
const DAY = 86_400;
const SOL = "So11111111111111111111111111111111111111112";

interface Call {
  path: string;
  query: URLSearchParams;
}

let calls: Call[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  process.env.BIRDEYE_API_KEY = "test-key";
  process.env.CACHE_TTL_SECONDS = "0";
  process.env.BIRDEYE_MAX_RETRIES = "0";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serve(routes: Record<string, (query: URLSearchParams) => unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ path: url.pathname, query: url.searchParams });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ message: `unrouted ${url.pathname}` }), { status: 404 });
    return new Response(JSON.stringify(route(url.searchParams)), { status: 200 });
  }) as typeof fetch;
}

function change(wallet: string, signature: string, timestamp: number, before: number, after: number) {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    address: wallet,
    token_account: "ata",
    pre_balance: String(before * 1e6),
    post_balance: String(after * 1e6),
    amount: String((after - before) * 1e6),
    token_info: { address: MINT, decimals: 6 },
  };
}

function swap(wallet: string, signature: string, timestamp: number, side: "buy" | "sell", quantity: number, usd?: number) {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    owner: wallet,
    side,
    tx_type: side,
    ins_index: 0,
    volume_usd: usd,
    source: "test_dex",
    from: side === "sell"
      ? { address: MINT, ui_change_amount: -quantity, ui_amount: quantity }
      : { address: SOL, symbol: "SOL", ui_change_amount: -(usd ?? 0) / 100, ui_amount: (usd ?? 0) / 100 },
    to: side === "buy"
      ? { address: MINT, ui_change_amount: quantity, ui_amount: quantity }
      : { address: SOL, symbol: "SOL", ui_change_amount: (usd ?? 0) / 100, ui_amount: (usd ?? 0) / 100 },
  };
}

function tradesRoute(trades: ReturnType<typeof swap>[]) {
  return (query: URLSearchParams) => {
    const after = Number(query.get("after_time"));
    const before = Number(query.get("before_time"));
    const side = query.get("tx_type");
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    const matched = trades
      .filter((trade) => trade.block_unix_time >= after && trade.block_unix_time <= before)
      .filter((trade) => side === "swap" || trade.side === side)
      .sort((a, b) => b.block_unix_time - a.block_unix_time);
    const items = matched.slice(offset, offset + limit);
    return { data: { items, has_next: offset + items.length < matched.length } };
  };
}

test("replay builds the full ledger: pre-trade transfers, late sells and only active buckets", async () => {
  const wallet = "WalletLedger1111111111111111111111111111111";
  const changes = [
    change(wallet, "gift", T0 - 40 * DAY, 0, 2),
    change(wallet, "buy", T0, 2, 12),
    // After Top Traders' (stale) lastTradeUnixTime. Must still be a sell.
    change(wallet, "sell", T0 + 60 * DAY, 12, 8),
  ];
  const trades = [swap(wallet, "buy", T0, "buy", 10, 100), swap(wallet, "sell", T0 + 60 * DAY, "sell", 4, 60)];
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 1, total_sell: 1 }, quantity: { holding: 8 }, pnl: { total_usd: 70 } } } },
    }),
    "/defi/price": () => ({ data: { value: 20 } }),
    "/wallet/v2/balance-change": (query) => ({ data: { items: Number(query.get("offset")) === 0 ? changes : [] } }),
    "/defi/v3/token/txs": tradesRoute(trades),
  });

  const result = await walletReplay({ mint: MINT, wallet, firstTradeAt: T0, lastTradeAt: T0 });
  assert.equal(result.mode, "ledger");
  const audit = result.row.audit!;
  assert.deepEqual(audit.ledger.events.map((event) => event.kind), ["transfer_in", "buy", "sell"]);
  assert.equal(audit.truncated, false);
  assert.equal(audit.reconciledQuantityDelta, 0);
  assert.equal(audit.spotPriceUsd, 20);
  assert.equal(result.row.holding, 8);
  assert.equal(audit.birdeyeTotalUsd, 70);

  const balanceCall = calls.find((call) => call.path === "/wallet/v2/balance-change")!;
  assert.equal(Number(balanceCall.query.get("time_from")), 1_609_459_200);
  const tradeWindows = new Set(
    calls.filter((call) => call.path === "/defi/v3/token/txs").map((call) => call.query.get("after_time")),
  );
  assert.equal(tradeWindows.size, 3, "one 29-day bucket per month that has a balance change");
  for (const call of calls.filter((item) => item.path === "/defi/v3/token/txs")) {
    assert.ok(Number(call.query.get("before_time")) - Number(call.query.get("after_time")) < 30 * DAY);
  }
  assert.equal(calls.some((call) => call.path === "/defi/v3/ohlcv"), false, "priced swaps need no fallback candles");
});

test("an unpriced swap fetches fallback candles once instead of booking a free buy", async () => {
  const wallet = "WalletUnpriced11111111111111111111111111111";
  serve({
    "/wallet/v2/pnl/multiple": () => ({ data: { data: {} } }),
    "/defi/price": () => ({ data: { value: 3 } }),
    "/wallet/v2/balance-change": (query) => ({
      data: { items: Number(query.get("offset")) === 0 ? [change(wallet, "buy", T0, 0, 10)] : [] },
    }),
    "/defi/v3/token/txs": tradesRoute([{ ...swap(wallet, "buy", T0, "buy", 10), to: { address: MINT, ui_change_amount: 10, ui_amount: 10 } }]),
    "/defi/v3/ohlcv": () => ({ data: { items: [{ unix_time: T0 - 3_600, o: 2, h: 2, l: 2, c: 2, v: 1 }] } }),
  });

  const result = await walletReplay({ mint: MINT, wallet });
  assert.equal(result.mode, "ledger");
  const buy = result.row.audit!.ledger.events[0]!;
  assert.equal(buy.kind, "buy");
  assert.equal(buy.priceUsd, 2);
  assert.equal(buy.exactExecution, false);
  assert.equal(calls.filter((call) => call.path === "/defi/v3/ohlcv").length, 1);
  assert.equal(result.row.audit!.ledger.unrealizedUsd, 10);
});

test("heavy wallets sample their own span and read buys and sells separately", async () => {
  const wallet = "WalletHeavy111111111111111111111111111111111";
  const first = T0;
  const last = T0 + 100 * DAY;
  const trades = [
    ...Array.from({ length: 150 }, (_, index) => swap(wallet, `buy-${index}`, last - 10 * DAY + index, "buy", 1, 1)),
    swap(wallet, "lonely-sell", last - 10 * DAY - 500, "sell", 50, 75),
  ];
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 12_000, total_sell: 3_000 }, quantity: { holding: 100 }, pnl: { total_usd: 1 } } } },
    }),
    "/defi/price": () => ({ data: { value: 1 } }),
    "/defi/v3/token/txs": tradesRoute(trades),
  });

  const result = await walletReplay({ mint: MINT, wallet, firstTradeAt: first, lastTradeAt: last });
  assert.equal(result.mode, "sample");
  if (result.mode !== "sample") return;
  assert.equal(calls.some((call) => call.path === "/wallet/v2/balance-change"), false);
  const tradeCalls = calls.filter((call) => call.path === "/defi/v3/token/txs");
  assert.ok(tradeCalls.every((call) => ["buy", "sell"].includes(call.query.get("tx_type") ?? "")));
  assert.equal(tradeCalls.filter((call) => call.query.get("tx_type") === "buy").length, result.windows);
  assert.equal(tradeCalls.filter((call) => call.query.get("tx_type") === "sell").length, result.windows);
  const now = Math.floor(Date.now() / 1_000);
  for (const call of tradeCalls) {
    assert.ok(Number(call.query.get("after_time")) >= first - 3_600, "never before the wallet's first trade");
    // Top Traders' last-trade time can lag, so the sample runs to now.
    assert.ok(Number(call.query.get("before_time")) <= now + 5);
  }
  assert.ok(tradeCalls.some((call) => Number(call.query.get("before_time")) > last), "covers time after the reported last trade");
  assert.ok(result.events.some((event) => event.signature === "lonely-sell" && event.kind === "sell"));
  assert.equal(result.sampled, true, "a full buy page is reported as a sample");
});

test("decoded swaps missing for most trades: markers come from balance changes", async () => {
  const wallet = "WalletUndecoded11111111111111111111111111111";
  const changes = Array.from({ length: 30 }, (_, index) =>
    change(wallet, `sig-${index}`, T0 + index * 3_600, index % 3 === 2 ? 20 : 10, index % 3 === 2 ? 10 : 20));
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 80, total_sell: 20 }, quantity: { holding: 10 }, pnl: { total_usd: 773_366 } } } },
    }),
    "/defi/price": () => ({ data: { value: 1 } }),
    "/wallet/v2/balance-change": (query) => ({ data: { items: Number(query.get("offset")) === 0 ? changes : [] } }),
    "/defi/v3/token/txs": () => ({ data: { items: [], has_next: false } }),
    "/defi/v3/ohlcv": () => ({ data: { items: [{ unix_time: T0 - 3_600, o: 2, h: 2, l: 2, c: 2, v: 1 }] } }),
  });

  const result = await walletReplay({ mint: MINT, wallet });
  assert.equal(result.mode, "inferred");
  if (result.mode !== "inferred") return;
  assert.equal(result.events.length, 30);
  assert.ok(result.events.every((event) => event.kind === "buy" || event.kind === "sell"));
  assert.equal(result.events.filter((event) => event.kind === "sell").length, 10);
  assert.ok(result.events.every((event) => event.priceUsd === 2 && event.exactExecution === false));
  assert.deepEqual(result.coverage, { birdeyeTrades: 100, decodedFills: 0, balanceEvents: 30 });
  assert.equal(result.row.totalUsd, 773_366, "PnL stays on Birdeye WAC");
});

test("a heavy wallet whose sampled windows return no swaps falls back to balance changes", async () => {
  const wallet = "WalletHeavyNoSwaps111111111111111111111111111";
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 20_000, total_sell: 0 }, quantity: { holding: 5 }, pnl: { total_usd: 9 } } } },
    }),
    "/defi/price": () => ({ data: { value: 1 } }),
    "/defi/v3/token/txs": () => ({ data: { items: [], has_next: false } }),
    "/wallet/v2/balance-change": (query) => {
      const from = Number(query.get("time_from"));
      const to = Number(query.get("time_to"));
      const at = T0 + 5 * DAY;
      return { data: { items: at >= from && at <= to ? [change(wallet, "acc-1", at, 0, 5)] : [] } };
    },
    "/defi/v3/ohlcv": () => ({ data: { items: [{ unix_time: T0, o: 3, h: 3, l: 3, c: 3, v: 1 }] } }),
  });

  const result = await walletReplay({ mint: MINT, wallet, firstTradeAt: T0 });
  assert.equal(result.mode, "inferred");
  if (result.mode !== "inferred") return;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.kind, "buy");
  assert.equal(result.coverage.decodedFills, 0);
  assert.ok(calls.some((call) => call.path === "/wallet/v2/balance-change"));
});
