import { cleanSymbol } from "@/lib/symbol";
import { createHash } from "node:crypto";
import { BirdeyeClient } from "../birdeye/client";
import type { BirdeyeCandle, BirdeyeTopTrader } from "../birdeye/types";
import type { ApiUsage } from "../birdeye/usage";
import type { LedgerResult } from "../pnl/ledger";
import { auditWalletRow, chooseInterval, HISTORY_FLOOR } from "./wallet-ledger";

export interface BuiltInPnlRow {
  counts?: { total_buy?: number | string; total_sell?: number | string; total_trade?: number | string };
  quantity?: {
    total_bought_amount?: number | string;
    total_sold_amount?: number | string;
    holding?: number | string;
  };
  cashflow_usd?: {
    total_invested?: number | string;
    total_sold?: number | string;
    current_value?: number | string;
  };
  pnl?: {
    realized_profit_usd?: number | string;
    unrealized_usd?: number | string;
    total_usd?: number | string;
    total_percent?: number | string;
  };
  pricing?: { current_price?: number | null; avg_buy_cost?: number | null; avg_sell_cost?: number | null };
}

export interface BoardRow {
  wallet: string;
  tags: string[];
  source: "birdeye-wac" | "audited-ledger";
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  holding: number;
  boughtUsd: number;
  soldUsd: number;
  buys: number;
  sells: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  firstTradeAt?: number;
  lastTradeAt?: number;
  audit?: {
    confidence: "high" | "medium" | "low";
    reasons: string[];
    birdeyeTotalUsd: number;
    deltaUsd: number;
    reconciledQuantityDelta: number;
    exactExecutionRatio: number;
    unknownBasisRatio: number;
    truncated: boolean;
    eventCount: number;
    /** Mark used for unrealized PnL, so a replay can land on the same total. */
    spotPriceUsd?: number;
    ledger: LedgerResult;
  };
}

export interface TokenAnalysis {
  demo?: boolean;
  token: { mint: string; name?: string; symbol?: string; logo?: string; decimals?: number };
  solPriceUsd: number;
  spotPriceUsd: number;
  /** Circulating supply and market cap, for entry market cap in the video. */
  market?: { circulatingSupply: number; marketCapUsd: number; holders: number };
  generatedAt: number;
  methodology: "wac+balance-reconciliation";
  candles: BirdeyeCandle[];
  board: BoardRow[];
  /** Birdeye requests and compute units this analysis spent. */
  usage?: ApiUsage;
  /** Whose key paid: the visitor's own or the deployment's. */
  keySource?: "visitor" | "server";
  auditSummary: {
    requested: number;
    completed: number;
    skippedHeavy?: number;
    high: number;
    medium: number;
    low: number;
  };
}

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function candidateUnion(groups: BirdeyeTopTrader[][]): BirdeyeTopTrader[] {
  const merged = new Map<string, BirdeyeTopTrader>();
  for (const group of groups) {
    for (const row of group) {
      if (!row.owner) continue;
      const held = merged.get(row.owner);
      merged.set(row.owner, held ? { ...held, ...row, tags: [...new Set([...(held.tags ?? []), ...(row.tags ?? [])])] } : row);
    }
  }
  return [...merged.values()];
}

export function builtInRows(response: unknown): Record<string, BuiltInPnlRow> {
  const body = response as { data?: { data?: Record<string, BuiltInPnlRow> } };
  return body.data?.data ?? {};
}

export function rowFromBuiltIn(candidate: BirdeyeTopTrader, pnl: BuiltInPnlRow): BoardRow {
  return {
    wallet: candidate.owner,
    tags: candidate.tags ?? [],
    source: "birdeye-wac",
    realizedUsd: number(pnl.pnl?.realized_profit_usd ?? candidate.realizedPnl),
    unrealizedUsd: number(pnl.pnl?.unrealized_usd ?? candidate.unrealizedPnl),
    totalUsd: number(pnl.pnl?.total_usd ?? candidate.totalPnl),
    holding: number(pnl.quantity?.holding ?? candidate.holdVolume),
    boughtUsd: number(pnl.cashflow_usd?.total_invested ?? candidate.volumeBuyUSD),
    soldUsd: number(pnl.cashflow_usd?.total_sold ?? candidate.volumeSellUSD),
    buys: number(pnl.counts?.total_buy ?? candidate.tradeBuy),
    sells: number(pnl.counts?.total_sell ?? candidate.tradeSell),
    avgBuyPrice: number(pnl.pricing?.avg_buy_cost ?? candidate.avgBuyPrice),
    avgSellPrice: number(pnl.pricing?.avg_sell_cost ?? candidate.avgSellPrice),
    firstTradeAt: candidate.firstTradeUnixTime,
    lastTradeAt: candidate.lastTradeUnixTime,
  };
}

async function analyzeTokenUncached(mint: string, requestedAudit: number | undefined, apiKey: string): Promise<TokenAnalysis> {
  const client = new BirdeyeClient(apiKey);
  const auditCount = Math.max(0, Math.min(requestedAudit ?? Number(process.env.AUDIT_WALLETS ?? 8), 20));
  const maxEvents = Number(process.env.AUDIT_MAX_EVENTS ?? 10_000);
  const maxAuditTrades = Number(process.env.AUDIT_MAX_TRADES ?? 5_000);
  const candidatesPerLens = Math.max(10, Math.min(30, Number(process.env.CANDIDATES_PER_LENS ?? 10)));
  const now = Math.floor(Date.now() / 1_000);

  const [metadata, solPriceUsd, tokenPriceUsd, market, ...rankings] = await Promise.all([
    client.tokenMetadata(mint),
    client.tokenPrice("So11111111111111111111111111111111111111112"),
    client.tokenPrice(mint),
    // Optional enrichment: a plan without market data still gets a board.
    client.tokenMarketData(mint).catch(() => null),
    client.topTraders(mint, "total_pnl", "desc", candidatesPerLens),
    client.topTraders(mint, "total_pnl", "asc", candidatesPerLens),
    client.topTraders(mint, "realized_pnl", "desc", candidatesPerLens),
    client.topTraders(mint, "unrealized_pnl", "desc", candidatesPerLens),
    client.topTraders(mint, "volume_usd", "desc", candidatesPerLens),
    client.topTraders(mint, "hold_volume", "desc", candidatesPerLens),
  ]);
  const candidates = candidateUnion(rankings).slice(0, 300);
  const earliest = candidates.reduce(
    (value, item) => Math.min(value, item.firstTradeUnixTime || value),
    now - 30 * 86_400,
  );
  const chartFrom = Math.max(1_609_459_200, earliest - 3_600);
  const walletBatches: string[][] = [];
  for (let index = 0; index < candidates.length; index += 50) {
    walletBatches.push(candidates.slice(index, index + 50).map((row) => row.owner));
  }
  const [candles, ...pnlResponses] = await Promise.all([
    client.ohlcv(mint, chartFrom, now, chooseInterval(now - chartFrom)),
    ...walletBatches.map((wallets) => client.walletPnlMultiple(mint, wallets)),
  ]);

  const spotPriceUsd = tokenPriceUsd > 0 ? tokenPriceUsd : candles.at(-1)?.c ?? 0;
  const pnl = new Map<string, BuiltInPnlRow>();
  for (const response of pnlResponses) {
    const rows = builtInRows(response);
    for (const [wallet, data] of Object.entries(rows)) pnl.set(wallet, data);
  }

  let board = candidates.map((candidate) => rowFromBuiltIn(candidate, pnl.get(candidate.owner) ?? {}));
  board.sort((a, b) => Math.abs(b.totalUsd) - Math.abs(a.totalUsd));

  const auditTargets = board
    .filter((row) => row.buys + row.sells <= maxAuditTrades)
    .slice(0, auditCount);
  const skippedHeavy = Math.min(auditCount, board.length) - auditTargets.length;
  const audited = new Map<string, BoardRow>();
  await Promise.all(
    auditTargets.map(async (row) => {
      const result = await auditWalletRow({ client, mint, row, to: now, spotPriceUsd, maxEvents, candles });
      audited.set(row.wallet, result.row);
    }),
  );
  board = board.map((row) => audited.get(row.wallet) ?? row).sort((a, b) => b.totalUsd - a.totalUsd);

  const completed = [...audited.values()];
  return {
    token: {
      mint,
      name: metadata?.name,
      symbol: cleanSymbol(metadata?.symbol),
      logo: metadata?.logo_uri,
      decimals: metadata?.decimals,
    },
    generatedAt: now,
    methodology: "wac+balance-reconciliation",
    solPriceUsd,
    spotPriceUsd,
    market: market ?? undefined,
    candles,
    board,
    usage: client.usage(),
    auditSummary: {
      requested: auditCount,
      completed: completed.length,
      skippedHeavy,
      high: completed.filter((row) => row.audit?.confidence === "high").length,
      medium: completed.filter((row) => row.audit?.confidence === "medium").length,
      low: completed.filter((row) => row.audit?.confidence === "low").length,
    },
  };
}

/**
 * The token half of an analysis with no trader board: metadata, market data,
 * spot and SOL prices, and the token's whole chart. Wallet mode opens a video
 * from this, so a wallet's token never pays for a Top Traders sweep.
 */
async function tokenContextUncached(mint: string, apiKey: string): Promise<TokenAnalysis> {
  const client = new BirdeyeClient(apiKey);
  const now = Math.floor(Date.now() / 1_000);
  const [metadata, solPriceUsd, tokenPriceUsd, market, daily] = await Promise.all([
    client.tokenMetadata(mint),
    client.tokenPrice("So11111111111111111111111111111111111111112"),
    client.tokenPrice(mint),
    client.tokenMarketData(mint).catch(() => null),
    // Daily bars from the floor find where the token's history starts.
    client.ohlcv(mint, HISTORY_FLOOR, now, "1D"),
  ]);
  const listedAt = daily[0]?.unixTime ?? now - 30 * 86_400;
  const chartFrom = Math.max(HISTORY_FLOOR, listedAt - 3_600);
  const interval = chooseInterval(now - chartFrom);
  // Young tokens get finer bars than one per day.
  const candles = interval === "1D" && daily.length > 0 ? daily : await client.ohlcv(mint, chartFrom, now, interval);
  return {
    token: { mint, name: metadata?.name, symbol: cleanSymbol(metadata?.symbol), logo: metadata?.logo_uri, decimals: metadata?.decimals },
    generatedAt: now,
    methodology: "wac+balance-reconciliation",
    solPriceUsd,
    spotPriceUsd: tokenPriceUsd > 0 ? tokenPriceUsd : candles.at(-1)?.c ?? 0,
    market: market ?? undefined,
    candles,
    board: [],
    usage: client.usage(),
    auditSummary: { requested: 0, completed: 0, high: 0, medium: 0, low: 0 },
  };
}

const analysisCache = new Map<string, { expiresAt: number; value: Promise<TokenAnalysis> }>();

function cachedAnalysis(key: string, build: () => Promise<TokenAnalysis>): Promise<TokenAnalysis> {
  const now = Date.now();
  const cached = analysisCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const ttlMs = Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1_000;
  const value = build();
  analysisCache.set(key, { expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (analysisCache.get(key)?.value === value) analysisCache.delete(key);
  });
  return value;
}

export function tokenContext(mint: string, apiKey = process.env.BIRDEYE_API_KEY ?? ""): Promise<TokenAnalysis> {
  const key = `${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}:${mint}:context`;
  return cachedAnalysis(key, () => tokenContextUncached(mint, apiKey));
}

export async function analyzeToken(
  mint: string,
  requestedAudit?: number,
  apiKey = process.env.BIRDEYE_API_KEY ?? "",
): Promise<TokenAnalysis> {
  const audit = requestedAudit ?? Number(process.env.AUDIT_WALLETS ?? 8);
  // Analyses are cached per key, so one visitor's spend is never served to another.
  const key = `${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}:${mint}:${audit}`;
  const now = Date.now();
  const cached = analysisCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const ttlMs = Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1_000;
  const value = analyzeTokenUncached(mint, audit, apiKey);
  analysisCache.set(key, { expiresAt: now + ttlMs, value });
  try {
    return await value;
  } catch (error) {
    if (analysisCache.get(key)?.value === value) analysisCache.delete(key);
    throw error;
  }
}
