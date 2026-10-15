import { calculateLedger, type LedgerEvent } from "@/server/pnl/ledger";
import type { BoardRow } from "@/server/services/analyze-token";

export interface VideoMetrics {
  realizedUsd: number;
  unrealizedUsd: number;
  totalUsd: number;
  /** Ledger clips only: weighted-average cost of the paid inventory held. */
  avgCostUsd?: number;
}

export type QuoteUnit = "USDC" | "SOL";

export function tradeValueInUnit(event: LedgerEvent, unit: QuoteUnit, solPriceUsd: number): number {
  if (unit === "USDC") return event.valueUsd;
  if (event.settlementSymbol === "SOL" && event.settlementAmount) return event.settlementAmount;
  return solPriceUsd > 0 ? event.valueUsd / solPriceUsd : 0;
}

/** Reduce dense swap streams into an alternating, chronological overlay story. */
export function selectOverlayEvents(events: LedgerEvent[], maxCount: number): LedgerEvent[] {
  const trades = events.filter((event) => event.kind === "buy" || event.kind === "sell");
  const groups: LedgerEvent[][] = [];
  for (const event of trades) {
    const held = groups.at(-1);
    if (!held || held[0]?.kind !== event.kind) groups.push([event]);
    else held.push(event);
  }
  const representatives = groups.map((group) =>
    group.reduce((best, event) => event.valueUsd > best.valueUsd ? event : best),
  );
  if (representatives.length <= maxCount) return representatives;
  return Array.from({ length: maxCount }, (_, index) =>
    representatives[Math.round((index / Math.max(maxCount - 1, 1)) * (representatives.length - 1))]!,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Audited clips replay the ledger, marked to each frame's price. Birdeye WAC
 * clips (sampled or truncated history) use the trade path for timing, then
 * normalize the final frame to Birdeye's totals.
 */
export function walletVideoMetrics(options: {
  row: BoardRow;
  events: LedgerEvent[];
  currentEvents: LedgerEvent[];
  currentPrice: number;
  finalPrice: number;
  reveal: number;
}): VideoMetrics {
  const { row, events, currentEvents, currentPrice, finalPrice } = options;
  if (row.audit) {
    // The closing frame is the board number itself: same ledger, marked at
    // the spot the audit used rather than the last candle in the window.
    if (options.reveal >= 0.9999) {
      return { realizedUsd: row.realizedUsd, unrealizedUsd: row.unrealizedUsd, totalUsd: row.totalUsd };
    }
    const ledger = calculateLedger(currentEvents, currentPrice);
    return {
      realizedUsd: ledger.realizedUsd,
      unrealizedUsd: ledger.unrealizedUsd,
      totalUsd: ledger.totalUsd,
      avgCostUsd: ledger.paidQuantity > 0 ? ledger.costBasisUsd / ledger.paidQuantity : 0,
    };
  }

  const reveal = clamp(options.reveal, 0, 1);
  if (reveal >= 0.9999) {
    return { realizedUsd: row.realizedUsd, unrealizedUsd: row.unrealizedUsd, totalUsd: row.totalUsd };
  }
  const trades = events.filter((event) => event.kind === "buy" || event.kind === "sell");
  const currentTrades = currentEvents.filter((event) => event.kind === "buy" || event.kind === "sell");
  if (trades.length === 0) {
    const eased = 1 - (1 - reveal) ** 2;
    const realizedUsd = row.realizedUsd * eased;
    const unrealizedUsd = row.unrealizedUsd * eased;
    return { realizedUsd, unrealizedUsd, totalUsd: realizedUsd + unrealizedUsd };
  }

  const finalLedger = calculateLedger(trades, finalPrice);
  const currentLedger = calculateLedger(currentTrades, currentPrice);
  const activity = currentTrades.length / trades.length;
  const soldRatio = finalLedger.soldUsd > 0
    ? clamp(currentLedger.soldUsd / finalLedger.soldUsd, 0, 1)
    : activity;
  const positionRatio = finalLedger.paidQuantity > 0
    ? clamp(currentLedger.paidQuantity / finalLedger.paidQuantity, 0, 1.5)
    : activity;
  const priceRatio = finalPrice > 0 ? clamp(currentPrice / finalPrice, 0.2, 5) : 1;
  const realizedUsd = row.realizedUsd * soldRatio;
  const unrealizedUsd = row.unrealizedUsd * clamp(positionRatio * priceRatio, 0, 1.5);
  return { realizedUsd, unrealizedUsd, totalUsd: realizedUsd + unrealizedUsd };
}

export interface TradeTotals {
  /** Gross value bought so far, in the clip's unit. */
  bought: number;
  /** Gross value sold so far, in the clip's unit. */
  sold: number;
}

/**
 * Running totals of what the wallet has bought and sold. Ledger clips sum the
 * fills already on screen, so the closing frame is the sum of every buy and
 * every sell. Birdeye WAC clips take their timing from the trade path and land
 * on Birdeye's cash-flow totals, because a sample cannot sum to the truth.
 */
export function walletTradeTotals(options: {
  row: BoardRow;
  events: LedgerEvent[];
  currentEvents: LedgerEvent[];
  reveal: number;
  unit: QuoteUnit;
  solPriceUsd: number;
}): TradeTotals {
  const { row, unit, solPriceUsd } = options;
  const sum = (list: LedgerEvent[], kind: "buy" | "sell", value: (event: LedgerEvent) => number) =>
    list.reduce((total, event) => (event.kind === kind ? total + value(event) : total), 0);
  if (row.audit) {
    const inUnit = (event: LedgerEvent) => tradeValueInUnit(event, unit, solPriceUsd);
    return { bought: sum(options.currentEvents, "buy", inUnit), sold: sum(options.currentEvents, "sell", inUnit) };
  }

  const reveal = clamp(options.reveal, 0, 1);
  const toUnit = (usd: number) => (unit === "USDC" ? usd : solPriceUsd > 0 ? usd / solPriceUsd : 0);
  const usd = (event: LedgerEvent) => event.valueUsd;
  const side = (kind: "buy" | "sell", targetUsd: number) => {
    const target = toUnit(targetUsd);
    if (reveal >= 0.9999) return target;
    const final = sum(options.events, kind, usd);
    if (final <= 0) return target * (1 - (1 - reveal) ** 2);
    return target * clamp(sum(options.currentEvents, kind, usd) / final, 0, 1);
  };
  return { bought: side("buy", row.boughtUsd), sold: side("sell", row.soldUsd) };
}
