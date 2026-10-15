import assert from "node:assert/strict";
import test from "node:test";
import { boardRowForToken, identityTags, mergeTokens, tokenMultiple, viewTokens, type WalletTokenRow } from "../src/lib/wallet-portfolio";
import { buildWalletPortfolio, parseIdentity } from "../src/server/services/wallet-portfolio";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

const raw = (address: string, extra: Record<string, unknown> = {}) => ({
  address,
  symbol: `${address.slice(0, 3)} `,
  decimals: 6,
  last_trade_unix_time: 1_700_000_000,
  counts: { total_buy: 2, total_sell: 1 },
  quantity: { holding: 0 },
  cashflow_usd: { total_invested: 1_000, total_sold: 1_400, current_value: 0 },
  pnl: { realized_profit_usd: 400, unrealized_usd: 0, total_usd: 400 },
  pricing: { current_price: 0.5, avg_buy_cost: 0.25, avg_sell_cost: 0.35 },
  ...extra,
});

test("quote assets are hidden and counted; dust holdings read as closed", () => {
  const page = buildWalletPortfolio({
    wallet: "W",
    offset: 0,
    details: {
      data: {
        tokens: [
          raw(SOL),
          raw(USDC),
          raw("AAAtoken1111111111111111111111111", { quantity: { holding: 10 }, cashflow_usd: { total_invested: 50, total_sold: 0, current_value: 0.4 } }),
          raw("BBBtoken1111111111111111111111111", { quantity: { holding: 1_000 }, cashflow_usd: { total_invested: 50, total_sold: 0, current_value: 120 } }),
        ],
        summary: { unique_tokens: 4, counts: { total_buy: 8, total_sell: 4, total_win: 1, total_loss: 1, win_rate: 0.5 }, pnl: { total_usd: 800 } },
      },
    },
  });
  assert.equal(page.hiddenQuoteAssets, 2);
  assert.deepEqual(page.tokens.map((token) => [token.symbol, token.status]), [["AAA", "closed"], ["BBB", "holding"]]);
  assert.equal(page.summary.winRate, 0.5);
  assert.equal(page.nextOffset, null);
});

test("portfolio prices, values and logos win; untraded holdings join the first page only", () => {
  const details = { data: { tokens: [raw("BBBtoken1111111111111111111111111", { quantity: { holding: 5 } })] } };
  const portfolio = {
    data: {
      total_value: "5000",
      items: [
        { address: "BBBtoken1111111111111111111111111", symbol: "BBB", name: "Bee", logo_uri: "https://arweave.net/b", price: 2, amount: 5, value: "10" },
        { address: "CCCairdrop111111111111111111111111", symbol: "CCC", name: "Airdrop", price: 1, amount: 40, value: 40 },
        { address: "DDDdust11111111111111111111111111", symbol: "DDD", price: 1, amount: 0.2, value: 0.2 },
        { address: USDC, symbol: "USDC", price: 1, amount: 4_950, value: 4_950 },
      ],
    },
  };
  const first = buildWalletPortfolio({ wallet: "W", offset: 0, details, portfolio });
  assert.deepEqual(first.tokens.map((token) => [token.symbol, token.status, token.valueUsd]), [["BBB", "holding", 10], ["CCC", "held", 40]]);
  assert.equal(first.tokens[0]!.logo, "https://arweave.net/b");
  assert.equal(first.tokens[0]!.priceUsd, 2);
  assert.equal(first.summary.valueUsd, 5_000);
  const later = buildWalletPortfolio({ wallet: "W", offset: 100, details, portfolio });
  assert.equal(later.tokens.some((token) => token.status === "held"), false);
});

test("a full page of 100 rows asks for the next page", () => {
  const tokens = Array.from({ length: 100 }, (_, index) => raw(`T${String(index).padStart(3, "0")}token111111111111111111111111`));
  const page = buildWalletPortfolio({ wallet: "W", offset: 200, details: { data: { tokens } } });
  assert.equal(page.nextOffset, 300);
});

test("identity: empty responses are no identity; labels lead the tags", () => {
  assert.equal(parseIdentity({ success: true, data: {} }), undefined);
  const identity = parseIdentity({ data: { type: "wallet", label: "KOL: slingoor", tags: ["KOL"], domains: ["a.sol"] } });
  assert.deepEqual(identityTags(identity), ["KOL: slingoor", "KOL"]);
});

const row = (symbol: string, extra: Partial<WalletTokenRow>): WalletTokenRow => ({
  mint: `${symbol}mint`, symbol, status: "closed", buys: 1, sells: 1, investedUsd: 100, soldUsd: 0,
  realizedUsd: 0, unrealizedUsd: 0, totalUsd: 0, holding: 0, valueUsd: 0, priceUsd: 0, avgBuyPrice: 0, avgSellPrice: 0, ...extra,
});

test("filters and sorts the list; merging keeps one row per mint, traded over held", () => {
  const tokens = [
    row("A", { totalUsd: 50, lastTradeAt: 3 }),
    row("B", { status: "holding", totalUsd: -20, valueUsd: 80, lastTradeAt: 5 }),
    row("C", { status: "held", buys: 0, sells: 0, investedUsd: 0, valueUsd: 30 }),
  ];
  assert.deepEqual(viewTokens(tokens, "all", "recent").map((token) => token.symbol), ["B", "A", "C"]);
  assert.deepEqual(viewTokens(tokens, "holding", "value").map((token) => token.symbol), ["B", "C"]);
  assert.deepEqual(viewTokens(tokens, "closed", "pnl").map((token) => token.symbol), ["A"]);
  const merged = mergeTokens(tokens, [row("C", { totalUsd: 9 }), row("D", {})]);
  assert.deepEqual(merged.map((token) => [token.symbol, token.status]), [["A", "closed"], ["B", "holding"], ["C", "closed"], ["D", "closed"]]);
  assert.equal(tokenMultiple({ investedUsd: 100, totalUsd: 150 }), 2.5);
  assert.equal(tokenMultiple({ investedUsd: 0, totalUsd: 10 }), null);
});

test("the video row carries the wallet's own WAC numbers", () => {
  const board = boardRowForToken("W", row("A", { investedUsd: 1_000, soldUsd: 1_400, realizedUsd: 400, totalUsd: 400, buys: 2, sells: 1, avgBuyPrice: 0.25, lastTradeAt: 9 }), ["KOL"]);
  assert.equal(board.source, "birdeye-wac");
  assert.equal(board.boughtUsd, 1_000);
  assert.equal(board.lastTradeAt, 9);
  assert.deepEqual(board.tags, ["KOL"]);
  assert.equal(board.audit, undefined);
});
