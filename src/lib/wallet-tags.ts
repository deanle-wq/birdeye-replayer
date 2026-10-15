import type { LedgerEvent } from "@/server/pnl/ledger";

/**
 * Trader vocabulary for the clip: invested, entry market cap, sold, the
 * multiple, and a couple of achievement tags. Everything derives from the
 * row totals and the replayed fills, never from guesses about intent.
 */

export interface WalletStory {
  /** USD spent on buys. */
  investedUsd: number;
  /** USD received from sells. */
  soldUsd: number;
  totalUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  /** (invested + PnL) / invested; null when nothing was bought. */
  multiple: number | null;
  /** Average buy price × circulating supply; null without supply or buys. */
  entryMarketCapUsd: number | null;
  /** Average sell price, when the replay has priced sells. */
  avgSellPriceUsd: number | null;
  buys: number;
  sells: number;
  /** Share of the tokens this wallet received that left by transfer rather than a sale (0–1). */
  sentOutShare: number;
}

export function walletStory(input: {
  investedUsd: number;
  soldUsd: number;
  totalUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  events: LedgerEvent[];
  /** Birdeye's average costs, used when the replay has no priced fills. */
  avgBuyPriceUsd?: number;
  avgSellPriceUsd?: number;
  circulatingSupply?: number;
  buys?: number;
  sells?: number;
}): WalletStory {
  let boughtQty = 0;
  let boughtValue = 0;
  let soldQty = 0;
  let soldValue = 0;
  let buys = 0;
  let sells = 0;
  let receivedQty = 0;
  let sentQty = 0;
  for (const event of input.events) {
    if (event.kind === "transfer_in") receivedQty += event.quantity;
    if (event.kind === "transfer_out") sentQty += event.quantity;
    if (event.kind === "buy") {
      boughtQty += event.quantity;
      boughtValue += event.valueUsd;
      buys += 1;
    } else if (event.kind === "sell") {
      soldQty += event.quantity;
      soldValue += event.valueUsd;
      sells += 1;
    }
  }
  const avgBuy = boughtQty > 0 && boughtValue > 0 ? boughtValue / boughtQty : input.avgBuyPriceUsd ?? 0;
  return {
    investedUsd: input.investedUsd,
    soldUsd: input.soldUsd,
    totalUsd: input.totalUsd,
    realizedUsd: input.realizedUsd,
    unrealizedUsd: input.unrealizedUsd,
    multiple: input.investedUsd > 0 ? (input.investedUsd + input.totalUsd) / input.investedUsd : null,
    entryMarketCapUsd: entryMarketCap(avgBuy, input.circulatingSupply),
    avgSellPriceUsd: soldQty > 0 && soldValue > 0 ? soldValue / soldQty : input.avgSellPriceUsd || null,
    buys: input.buys ?? buys,
    sells: input.sells ?? sells,
    sentOutShare: boughtQty + receivedQty > 0 ? Math.min(1, sentQty / (boughtQty + receivedQty)) : 0,
  };
}

export interface WalletTag {
  emoji: string;
  label: string;
}

/**
 * Up to two tags, most telling first. Each rule is a plain reading of the
 * numbers on the card, so a viewer can check it.
 */
export function walletTags(story: WalletStory, context: {
  holding: boolean;
  currentPriceUsd: number;
  currentMarketCapUsd?: number;
  birdeyeTags?: string[];
}): WalletTag[] {
  const tags: WalletTag[] = [];
  const add = (emoji: string, label: string) => {
    if (tags.length < 2 && !tags.some((tag) => tag.label === label)) tags.push({ emoji, label });
  };
  const multiple = story.multiple;
  const soldNothing = story.soldUsd <= Math.max(1, story.investedUsd * 0.01);

  if (multiple !== null && multiple >= 10) add("🚀", "Moonshot");
  if (multiple !== null && multiple <= 0.2) add("💀", "Rekt");
  // Tokens that left by transfer explain a $0 result: the cost went with them.
  if (soldNothing && !context.holding && story.sentOutShare >= 0.9) add("📤", "Sent out");
  if (soldNothing && context.holding && story.investedUsd > 0) add("💎", "Diamond hands");
  if (!context.holding && story.avgSellPriceUsd && context.currentPriceUsd >= story.avgSellPriceUsd * 2) add("🧻", "Paper hands");
  if (story.realizedUsd > 0 && story.soldUsd > 0) add("💰", "Took profits");
  if (story.entryMarketCapUsd && context.currentMarketCapUsd && story.entryMarketCapUsd <= context.currentMarketCapUsd * 0.1) add("🐣", "Early bird");
  if (story.investedUsd >= 100_000) add("🐋", "Whale");
  if (context.holding && story.unrealizedUsd < 0 && multiple !== null && multiple < 0.5) add("🎒", "Bag holder");
  if (story.buys + story.sells >= 200) add("🎰", "Degen");
  if (context.birdeyeTags?.some((tag) => /sniper/i.test(tag))) add("🎯", "Sniper");
  return tags;
}

/** Average buy price × circulating supply, or null when either is unknown. */
export function entryMarketCap(avgBuyPriceUsd: number, circulatingSupply?: number): number | null {
  return avgBuyPriceUsd > 0 && circulatingSupply && circulatingSupply > 0 ? avgBuyPriceUsd * circulatingSupply : null;
}

/**
 * "17x" for big multiples, "1.4x" for small ones. A negative multiple means
 * the loss exceeds what was bought (transfers carried basis in), so there is
 * no honest multiple to show.
 */
export function formatMultiple(multiple: number | null): string | null {
  if (multiple === null || !Number.isFinite(multiple) || multiple < 0) return null;
  if (multiple < 0.01) return "<0.01x";
  if (multiple >= 10) return `${Math.round(multiple)}x`;
  if (multiple >= 1) return `${multiple.toFixed(1).replace(/\.0$/, "")}x`;
  return `${multiple.toFixed(2)}x`;
}

/** The wallet's Birdeye label, or "trader". */
export function walletRole(birdeyeTags?: string[]): string {
  const tag = birdeyeTags?.find(Boolean);
  return tag ? tag.replaceAll("_", " ") : "trader";
}
