import { DEMO_WALLET, type WalletPortfolio, type WalletTokenRow } from "@/lib/wallet-portfolio";
import type { BirdeyeCandle } from "./birdeye/types";
import { calculateLedger, type LedgerEvent } from "./pnl/ledger";
import type { TokenAnalysis, BoardRow } from "./services/analyze-token";

/**
 * Sample tokens. Real mints so links and logos make sense, synthetic candles
 * and wallets, always labelled "demo dataset" in the UI.
 */
interface DemoToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /** First close, and per-candle drift as a share of it. */
  base: number;
  drift: number;
  phase: number;
  supply: number;
  /** Scales the sample wallets' trade sizes on this token. */
  size: number;
}

const DEMO_TOKENS: DemoToken[] = [
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk — demo dataset", decimals: 5, base: 0.000021, drift: 0.0043, phase: 0, supply: 88_000_000_000_000, size: 1 },
  { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat — demo dataset", decimals: 6, base: 1.62, drift: -0.0026, phase: 1.7, supply: 998_840_000, size: 0.6 },
  { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat — demo dataset", decimals: 9, base: 0.41, drift: 0.0081, phase: 3.1, supply: 979_970_000, size: 1.6 },
];

/** A holding with no trades on record, to show the held-only state. */
const DEMO_HELD = { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter — demo dataset", amount: 12_400, price: 0.82 };

export function isDemoMint(mint: string): boolean {
  return DEMO_TOKENS.some((token) => token.mint === mint);
}

const wallets = [
  DEMO_WALLET,
  "7YttLkHDoViQW4cjoBZydPUnF6gFEoXv3mN8sR1aK5Jq",
  "4Nd1mLr2D8S7YpK6H3qZ9cV5bA1xEoTjWfUuGkP8sR2",
  "HwPp3oL8fT7dN2qK5vB9mS1xC6aZ4yEJgRuU8iVwQ3k",
  "2Fe47zbhYpQ8cM6vA1nR5sT9xK3dL7uEoW4gJqB8VfN",
  "A3ZcnXcC7pQ2mK9vN4sR6tY1dE8uL5gWjBfH3xVqP4a",
  "8WiUx5AhK2nV7cQ4mR9sT1yE6uP3dL5gBjF8xWvN2aZ",
  "BgKsDTAT9vQ4mN7sR2tY5uE1dL8gW3jF6xPpKcA4hVn",
  "CEikLmYN9dcDtHZC9qfwPpaUcLm3CNWMrR55Ub5mRyUn",
  "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa",
];

function row(index: number, candles: BirdeyeCandle[], size = 1): BoardRow {
  const totals = [184_520, 72_430, 31_880, 9_210, 2_840, -1_760, -8_420, -27_310, -64_900, -142_800];
  const total = totals[index] ?? 0;
  const realized = total * (index % 3 === 0 ? 0.82 : 0.64);
  const holding = Math.max(0, 12_500_000 - index * 1_070_000);
  const audited = index < 6;
  const confidence = index < 3 ? "high" : index < 5 ? "medium" : "low";
  const base: BoardRow = {
    wallet: wallets[index]!,
    tags: index === 0 ? ["smart_trader"] : index === 3 ? ["sniper"] : index === 5 ? ["bundler"] : [],
    source: audited ? "audited-ledger" : "birdeye-wac",
    realizedUsd: realized,
    unrealizedUsd: total - realized,
    totalUsd: total,
    holding,
    boughtUsd: 24_000 + index * 8_300,
    soldUsd: 31_000 + Math.max(total, 0),
    buys: 3 + index * 2,
    sells: 2 + index,
    avgBuyPrice: 0.000021 + index * 0.0000012,
    avgSellPrice: 0.000034 - index * 0.0000008,
    // Kept on the demo chart so the wallet-window replay has candles to frame.
    firstTradeAt: candles[Math.min(candles.length - 1, 8 + index * 3)]!.unixTime,
    lastTradeAt: candles[Math.min(candles.length - 1, 150 + index * 2)]!.unixTime,
  };
  if (!audited) return base;
  const events: LedgerEvent[] = Array.from({ length: 14 }, (_, eventIndex) => {
    const candle = candles[Math.min(candles.length - 1, 8 + eventIndex * 12 + index)]!;
    const kind = eventIndex % 3 === 2 ? "sell" : "buy";
    const valueUsd = (1_800 + eventIndex * 430 + index * 170) * size;
    const settlementSymbol = eventIndex % 2 === 0 ? "SOL" : "USDC";
    return {
      signature: `demo-${index}-${eventIndex}`,
      timestamp: candle.unixTime,
      kind,
      quantity: valueUsd / candle.c,
      priceUsd: candle.c,
      valueUsd,
      exactExecution: true,
      settlementSymbol,
      settlementAmount: settlementSymbol === "SOL" ? valueUsd / 145 : valueUsd,
      source: "demo",
    };
  });
  // Totals come from the ledger itself, so a replay of the sample walks to
  // exactly the number on the board instead of jumping at the end.
  const computed = calculateLedger(events, candles.at(-1)!.c);
  const ledger = {
    ...computed,
    exactExecutionRatio: index < 3 ? 0.99 : index < 5 ? 0.87 : 0.62,
    unknownBasisRatio: index < 3 ? 0.01 : index < 5 ? 0.11 : 0.28,
  };
  const birdeyeTotal = ledger.totalUsd * (index % 2 === 0 ? 0.91 : 1.13);
  return {
    ...base,
    realizedUsd: ledger.realizedUsd,
    unrealizedUsd: ledger.unrealizedUsd,
    totalUsd: ledger.totalUsd,
    holding: ledger.quantity,
    boughtUsd: ledger.boughtUsd,
    soldUsd: ledger.soldUsd,
    buys: ledger.buys,
    sells: ledger.sells,
    audit: {
      confidence,
      reasons: confidence === "high" ? [] : ["sample coverage warning"],
      birdeyeTotalUsd: birdeyeTotal,
      deltaUsd: ledger.totalUsd - birdeyeTotal,
      reconciledQuantityDelta: confidence === "low" ? holding * 0.08 : 0,
      exactExecutionRatio: ledger.exactExecutionRatio,
      unknownBasisRatio: ledger.unknownBasisRatio,
      truncated: confidence === "low",
      eventCount: 8 + index * 7,
      ledger,
    },
  };
}

/** The same seeded, multi-scale value noise used by the chart feature's sample. */
function demoNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}
function demoValueNoise(x: number, salt: number): number {
  const index = Math.floor(x);
  const fraction = x - index;
  const ease = fraction * fraction * (3 - 2 * fraction);
  const a = demoNoise(index * 7.13 + salt) * 2 - 1;
  const b = demoNoise((index + 1) * 7.13 + salt) * 2 - 1;
  return a + (b - a) * ease;
}
function demoPriceAt(index: number, spec: DemoToken): number {
  const chop = .16 * demoValueNoise(index / 12, spec.phase + 1)
    + .09 * demoValueNoise(index / 3, spec.phase + 2)
    + .045 * demoValueNoise(index * 2, spec.phase + 3)
    + .02 * demoValueNoise(index * 8, spec.phase + 4);
  return spec.base * Math.max(.19, 1 + index * spec.drift) * Math.exp(chop);
}

export function demoAnalysis(mint?: string): TokenAnalysis {
  const spec = DEMO_TOKENS.find((token) => token.mint === mint) ?? DEMO_TOKENS[0]!;
  const now = Math.floor(Date.now() / 3_600_000) * 3_600;
  const candles: BirdeyeCandle[] = Array.from({ length: 180 }, (_, index) => {
    const samples = Array.from({ length: 6 }, (_, step) => demoPriceAt(index + step / 5, spec));
    const open = samples[0]!;
    const close = samples.at(-1)!;
    // Match Chart's wick profile; the previous sine-wave sample made uniformly long wicks.
    const wick = 1 + .004 + .01 * demoNoise(index + spec.phase);
    return {
      unixTime: now - (179 - index) * 3_600,
      o: open, c: close,
      h: Math.max(...samples) * wick,
      l: Math.min(...samples) / wick,
      v: 1_000_000 + demoNoise(index * 7.13 + spec.phase) * 8_000_000,
      type: "1H",
    };
  });
  return {
    demo: true,
    token: { mint: spec.mint, name: spec.name, symbol: spec.symbol, decimals: spec.decimals },
    generatedAt: now,
    methodology: "wac+balance-reconciliation",
    solPriceUsd: 145,
    spotPriceUsd: candles.at(-1)?.c ?? 0,
    market: { circulatingSupply: spec.supply, marketCapUsd: (candles.at(-1)?.c ?? 0) * spec.supply, holders: 1_000_000 },
    candles,
    board: wallets.map((_, index) => row(index, candles, spec.size)).sort((a, b) => b.totalUsd - a.totalUsd),
    auditSummary: { requested: 6, completed: 6, high: 3, medium: 2, low: 1 },
  };
}

/** The sample wallet: the first demo trader across every demo token. */
export function demoWallet(): WalletPortfolio {
  const tokens: WalletTokenRow[] = DEMO_TOKENS.map((spec) => {
    const analysis = demoAnalysis(spec.mint);
    const board = analysis.board.find((entry) => entry.wallet === DEMO_WALLET)!;
    const price = analysis.spotPriceUsd;
    const valueUsd = board.holding * price;
    return {
      mint: spec.mint,
      symbol: spec.symbol,
      name: spec.name,
      decimals: spec.decimals,
      lastTradeAt: board.audit?.ledger.events.at(-1)?.timestamp ?? board.lastTradeAt,
      status: valueUsd >= 1 ? "holding" : "closed",
      buys: board.buys,
      sells: board.sells,
      investedUsd: board.boughtUsd,
      soldUsd: board.soldUsd,
      realizedUsd: board.realizedUsd,
      unrealizedUsd: board.unrealizedUsd,
      totalUsd: board.totalUsd,
      holding: board.holding,
      valueUsd,
      priceUsd: price,
      avgBuyPrice: board.avgBuyPrice,
      avgSellPrice: board.avgSellPrice,
    };
  });
  tokens.push({
    mint: DEMO_HELD.mint,
    symbol: DEMO_HELD.symbol,
    name: DEMO_HELD.name,
    status: "held",
    buys: 0,
    sells: 0,
    investedUsd: 0,
    soldUsd: 0,
    realizedUsd: 0,
    unrealizedUsd: 0,
    totalUsd: 0,
    holding: DEMO_HELD.amount,
    valueUsd: DEMO_HELD.amount * DEMO_HELD.price,
    priceUsd: DEMO_HELD.price,
    avgBuyPrice: 0,
    avgSellPrice: 0,
  });
  const traded = tokens.filter((token) => token.status !== "held");
  const sum = (pick: (token: WalletTokenRow) => number) => traded.reduce((total, token) => total + pick(token), 0);
  const wins = traded.filter((token) => token.totalUsd > 0).length;
  return {
    demo: true,
    wallet: DEMO_WALLET,
    identity: { label: "demo trader", tags: ["smart_trader"], domains: [] },
    summary: {
      tokens: traded.length + 2,
      buys: sum((token) => token.buys),
      sells: sum((token) => token.sells),
      wins,
      losses: traded.length - wins,
      winRate: traded.length > 0 ? wins / traded.length : 0,
      investedUsd: sum((token) => token.investedUsd),
      soldUsd: sum((token) => token.soldUsd),
      realizedUsd: sum((token) => token.realizedUsd),
      unrealizedUsd: sum((token) => token.unrealizedUsd),
      totalUsd: sum((token) => token.totalUsd),
      valueUsd: tokens.reduce((total, token) => total + token.valueUsd, 0) + 4_210,
    },
    tokens,
    hiddenQuoteAssets: 2,
    nextOffset: null,
    generatedAt: Math.floor(Date.now() / 1_000),
  };
}
