import type { ApiUsage } from "@/server/birdeye/usage";
import type { BoardRow } from "@/server/services/analyze-token";

/**
 * Wallet mode: one wallet in, every token it traded or holds out. Shared by
 * the API route and the browser, so it holds types and pure helpers only.
 */

/**
 * Quote assets show up in a wallet's PnL as the other leg of every swap.
 * Their "PnL" is price drift on working capital, not a trade, so the list
 * leaves them out and says how many it hid.
 */
export const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // SOL / wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", // USD1
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
]);

/** The sample dataset's wallet (synthetic). */
export const DEMO_WALLET = "9xQeWvG816bUx9EPf5G7t8sMZyJ3qhYpK1nL2cV4bA6D";

/** Below this USD value an open position counts as closed (dust). */
export const DUST_USD = 1;

export type WalletTokenStatus = "holding" | "closed" | "held";

export interface WalletTokenRow {
  mint: string;
  symbol: string;
  name?: string;
  logo?: string;
  decimals?: number;
  lastTradeAt?: number;
  /** holding: traded and still open; closed: traded and exited; held: in the wallet with no trades. */
  status: WalletTokenStatus;
  buys: number;
  sells: number;
  investedUsd: number;
  soldUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  /** Token quantity still held. */
  holding: number;
  valueUsd: number;
  priceUsd: number;
  avgBuyPrice: number;
  avgSellPrice: number;
}

export interface WalletIdentity {
  type?: string;
  entity?: string;
  label?: string;
  category?: string;
  tags: string[];
  domains: string[];
}

export interface WalletSummary {
  /** Distinct tokens Birdeye counts for this wallet, quote assets included. */
  tokens: number;
  buys: number;
  sells: number;
  wins: number;
  losses: number;
  winRate: number;
  investedUsd: number;
  soldUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  /** Current portfolio value, all assets. */
  valueUsd: number;
}

export interface WalletPortfolio {
  demo?: boolean;
  wallet: string;
  identity?: WalletIdentity;
  summary: WalletSummary;
  tokens: WalletTokenRow[];
  /** Quote-asset rows (SOL, USDC, USDT…) left out of `tokens`. */
  hiddenQuoteAssets: number;
  /** Offset for the next page of traded tokens, or null when this was the last. */
  nextOffset: number | null;
  /**
   * "90d" when Birdeye could not compute this wallet's all-time PnL and the
   * list falls back to the last 90 days; later pages must ask for the same.
   */
  historyWindow?: HistoryWindow;
  generatedAt: number;
  usage?: ApiUsage;
  keySource?: "visitor" | "server";
}

export type HistoryWindow = "all" | "90d";

export type WalletFilter = "all" | "holding" | "closed";
export type WalletSort = "recent" | "pnl" | "invested" | "value";

/** (invested + PnL) / invested, as on the board and the video card. */
export function tokenMultiple(token: Pick<WalletTokenRow, "investedUsd" | "totalUsd">): number | null {
  return token.investedUsd > 0 ? (token.investedUsd + token.totalUsd) / token.investedUsd : null;
}

export function viewTokens(tokens: WalletTokenRow[], filter: WalletFilter, sort: WalletSort): WalletTokenRow[] {
  const kept = tokens.filter((token) =>
    filter === "all" ? true : filter === "holding" ? token.status !== "closed" : token.status === "closed",
  );
  const by: Record<WalletSort, (token: WalletTokenRow) => number> = {
    recent: (token) => token.lastTradeAt ?? 0,
    pnl: (token) => token.totalUsd,
    invested: (token) => token.investedUsd,
    value: (token) => token.valueUsd,
  };
  return [...kept].sort((a, b) => by[sort](b) - by[sort](a) || a.symbol.localeCompare(b.symbol));
}

/** Merge a later page into what is loaded, keeping one row per mint. */
export function mergeTokens(loaded: WalletTokenRow[], page: WalletTokenRow[]): WalletTokenRow[] {
  const byMint = new Map(loaded.map((token) => [token.mint, token]));
  for (const token of page) {
    const held = byMint.get(token.mint);
    // A traded row beats a held-only row for the same mint.
    if (!held || held.status === "held") byMint.set(token.mint, token);
  }
  return [...byMint.values()];
}

/** The row the video editor expects, built from the wallet's own numbers. */
export function boardRowForToken(wallet: string, token: WalletTokenRow, tags: string[]): BoardRow {
  return {
    wallet,
    tags,
    source: "birdeye-wac",
    realizedUsd: token.realizedUsd,
    unrealizedUsd: token.unrealizedUsd,
    totalUsd: token.totalUsd,
    holding: token.holding,
    boughtUsd: token.investedUsd,
    soldUsd: token.soldUsd,
    buys: token.buys,
    sells: token.sells,
    avgBuyPrice: token.avgBuyPrice,
    avgSellPrice: token.avgSellPrice,
    lastTradeAt: token.lastTradeAt,
  };
}

/** Labels to show for a wallet: Birdeye identity first, then its category. */
export function identityTags(identity?: WalletIdentity): string[] {
  if (!identity) return [];
  const tags = [...identity.tags];
  if (identity.label && !tags.includes(identity.label)) tags.unshift(identity.label);
  return tags.filter(Boolean).slice(0, 3);
}
