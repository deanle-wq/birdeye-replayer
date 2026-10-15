import { cleanSymbol } from "@/lib/symbol";
import { createHash } from "node:crypto";
import {
  DUST_USD,
  QUOTE_MINTS,
  type HistoryWindow,
  type WalletIdentity,
  type WalletPortfolio,
  type WalletSummary,
  type WalletTokenRow,
} from "@/lib/wallet-portfolio";
import { BirdeyeClient, BirdeyeError } from "../birdeye/client";
import type { BirdeyeTokenMetadata } from "../birdeye/types";

const PAGE_SIZE = 100;
const METADATA_BATCH = 20;

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface RawPnlToken {
  address?: string;
  symbol?: string;
  decimals?: number;
  last_trade_unix_time?: number;
  counts?: { total_buy?: number; total_sell?: number };
  quantity?: { holding?: number };
  cashflow_usd?: { total_invested?: number; total_sold?: number; current_value?: number };
  pnl?: { realized_profit_usd?: number; unrealized_usd?: number; total_usd?: number };
  pricing?: { current_price?: number | null; avg_buy_cost?: number | null; avg_sell_cost?: number | null };
}

interface RawPnlDetails {
  data?: {
    tokens?: RawPnlToken[];
    summary?: {
      unique_tokens?: number;
      counts?: { total_buy?: number; total_sell?: number; total_win?: number; total_loss?: number; win_rate?: number };
      cashflow_usd?: { total_invested?: number; total_sold?: number; current_value?: number };
      pnl?: { realized_profit_usd?: number; unrealized_usd?: number; total_usd?: number };
    };
  };
}

interface RawPortfolioItem {
  address?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  logo_uri?: string;
  price?: number | string;
  amount?: number | string;
  value?: number | string;
}

interface RawPortfolio {
  data?: { total_value?: number | string; items?: RawPortfolioItem[] };
}

interface RawIdentity {
  data?: { type?: string; entity?: string; label?: string; category?: string; tags?: string[]; domains?: string[] };
}

export function parseIdentity(raw: unknown): WalletIdentity | undefined {
  const data = (raw as RawIdentity | null)?.data;
  if (!data || (!data.label && !data.entity && !(data.tags?.length) && !(data.domains?.length))) return undefined;
  return {
    type: data.type,
    entity: data.entity,
    label: data.label,
    category: data.category,
    tags: (data.tags ?? []).filter((tag) => typeof tag === "string"),
    domains: (data.domains ?? []).slice(0, 5),
  };
}

/**
 * Pure assembly of one page, so the rules (quote assets out, dust counts as
 * closed, portfolio prices win over stale PnL marks) are testable offline.
 */
export function buildWalletPortfolio(input: {
  wallet: string;
  offset: number;
  details: unknown;
  portfolio?: unknown;
  identity?: unknown;
  metadata?: Record<string, BirdeyeTokenMetadata>;
  now?: number;
}): Omit<WalletPortfolio, "usage" | "keySource"> {
  const details = (input.details as RawPnlDetails | null)?.data ?? {};
  const rawTokens = details.tokens ?? [];
  const holdings = new Map<string, RawPortfolioItem>();
  for (const item of (input.portfolio as RawPortfolio | null)?.data?.items ?? []) {
    if (item.address) holdings.set(item.address, item);
  }
  const metadata = input.metadata ?? {};

  let hiddenQuoteAssets = 0;
  const tokens: WalletTokenRow[] = [];
  for (const raw of rawTokens) {
    const mint = raw.address;
    if (!mint) continue;
    if (QUOTE_MINTS.has(mint)) {
      hiddenQuoteAssets += 1;
      continue;
    }
    const held = holdings.get(mint);
    const meta = metadata[mint];
    const holding = held ? number(held.amount) : number(raw.quantity?.holding);
    const valueUsd = held ? number(held.value) : number(raw.cashflow_usd?.current_value);
    tokens.push({
      mint,
      symbol: cleanSymbol(held?.symbol ?? meta?.symbol ?? raw.symbol) ?? mint.slice(0, 4),
      name: (held?.name ?? meta?.name)?.trim() || undefined,
      logo: held?.logo_uri || meta?.logo_uri || undefined,
      decimals: raw.decimals ?? meta?.decimals,
      lastTradeAt: raw.last_trade_unix_time || undefined,
      status: holding > 0 && valueUsd >= DUST_USD ? "holding" : "closed",
      buys: number(raw.counts?.total_buy),
      sells: number(raw.counts?.total_sell),
      investedUsd: number(raw.cashflow_usd?.total_invested),
      soldUsd: number(raw.cashflow_usd?.total_sold),
      realizedUsd: number(raw.pnl?.realized_profit_usd),
      unrealizedUsd: number(raw.pnl?.unrealized_usd),
      totalUsd: number(raw.pnl?.total_usd),
      holding,
      valueUsd,
      priceUsd: held ? number(held.price) : number(raw.pricing?.current_price),
      avgBuyPrice: number(raw.pricing?.avg_buy_cost),
      avgSellPrice: number(raw.pricing?.avg_sell_cost),
    });
  }

  // Holdings with no trades on record (airdrops, transfers in) come with the
  // first page only, after the traded tokens.
  if (input.offset === 0) {
    const traded = new Set(rawTokens.map((raw) => raw.address));
    for (const [mint, item] of holdings) {
      if (traded.has(mint) || QUOTE_MINTS.has(mint) || number(item.value) < DUST_USD) continue;
      tokens.push({
        mint,
        symbol: cleanSymbol(item.symbol) ?? mint.slice(0, 4),
        name: item.name?.trim() || undefined,
        logo: item.logo_uri || undefined,
        decimals: item.decimals,
        status: "held",
        buys: 0,
        sells: 0,
        investedUsd: 0,
        soldUsd: 0,
        realizedUsd: 0,
        unrealizedUsd: 0,
        totalUsd: 0,
        holding: number(item.amount),
        valueUsd: number(item.value),
        priceUsd: number(item.price),
        avgBuyPrice: 0,
        avgSellPrice: 0,
      });
    }
  }

  const raw = details.summary ?? {};
  const summary: WalletSummary = {
    tokens: number(raw.unique_tokens),
    buys: number(raw.counts?.total_buy),
    sells: number(raw.counts?.total_sell),
    wins: number(raw.counts?.total_win),
    losses: number(raw.counts?.total_loss),
    winRate: number(raw.counts?.win_rate),
    investedUsd: number(raw.cashflow_usd?.total_invested),
    soldUsd: number(raw.cashflow_usd?.total_sold),
    realizedUsd: number(raw.pnl?.realized_profit_usd),
    unrealizedUsd: number(raw.pnl?.unrealized_usd),
    totalUsd: number(raw.pnl?.total_usd),
    valueUsd: number((input.portfolio as RawPortfolio | null)?.data?.total_value ?? raw.cashflow_usd?.current_value),
  };

  return {
    wallet: input.wallet,
    identity: parseIdentity(input.identity),
    summary,
    tokens,
    hiddenQuoteAssets,
    nextOffset: rawTokens.length >= PAGE_SIZE ? input.offset + rawTokens.length : null,
    generatedAt: input.now ?? Math.floor(Date.now() / 1_000),
  };
}

/**
 * Birdeye answers some long-lived wallets' all-time PnL with a 400 or 5xx
 * "Internal server error" while the 90-day window works. Key, plan and rate
 * limit errors are not that, and must surface as they are.
 */
export function allTimeHistoryFailed(error: unknown): boolean {
  return error instanceof BirdeyeError && (error.status === 400 || error.status >= 500);
}

async function walletPortfolioUncached(wallet: string, offset: number, apiKey: string, window: HistoryWindow): Promise<WalletPortfolio> {
  const client = new BirdeyeClient(apiKey);
  const first = offset === 0;
  let historyWindow = window;
  const details = client.walletPnlDetails(wallet, offset, PAGE_SIZE, window).catch((error: unknown) => {
    if (window !== "all" || !allTimeHistoryFailed(error)) throw error;
    historyWindow = "90d";
    return client.walletPnlDetails(wallet, offset, PAGE_SIZE, "90d");
  });
  const [detailsBody, portfolio, identity] = await Promise.all([
    details,
    // Enrichment: a plan or wallet without these still gets its token list.
    first ? client.walletPortfolio(wallet).catch(() => null) : Promise.resolve(null),
    first ? client.walletIdentity(wallet).catch(() => null) : Promise.resolve(null),
  ]);

  // Logos and names for traded tokens the portfolio does not already cover.
  const known = new Set(((portfolio as RawPortfolio | null)?.data?.items ?? []).map((item) => item.address));
  const missing = ((detailsBody as RawPnlDetails | null)?.data?.tokens ?? [])
    .map((token) => token.address)
    .filter((mint): mint is string => Boolean(mint) && !known.has(mint) && !QUOTE_MINTS.has(mint!));
  const batches: string[][] = [];
  for (let index = 0; index < missing.length; index += METADATA_BATCH) batches.push(missing.slice(index, index + METADATA_BATCH));
  const metadata = Object.assign(
    {},
    ...(await Promise.all(batches.map((batch) => client.tokenMetadataMultiple(batch).catch(() => ({}))))),
  ) as Record<string, BirdeyeTokenMetadata>;

  return {
    ...buildWalletPortfolio({ wallet, offset, details: detailsBody, portfolio, identity, metadata }),
    historyWindow,
    usage: client.usage(),
  };
}

const cache = new Map<string, { expiresAt: number; value: Promise<WalletPortfolio> }>();

export async function walletPortfolio(wallet: string, offset = 0, apiKey = process.env.BIRDEYE_API_KEY ?? "", window: HistoryWindow = "all"): Promise<WalletPortfolio> {
  const key = `${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}:${wallet}:${offset}:${window}`;
  const now = Date.now();
  const held = cache.get(key);
  if (held && held.expiresAt > now) return held.value;
  const ttlMs = Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1_000;
  const value = walletPortfolioUncached(wallet, offset, apiKey, window);
  cache.set(key, { expiresAt: now + ttlMs, value });
  try {
    return await value;
  } catch (error) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  }
}
