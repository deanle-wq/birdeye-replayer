import type { BirdeyeClient } from "../birdeye/client";
import { crawlOffsetWindows } from "../birdeye/paginate";
import type { BirdeyeBalanceChange, BirdeyeCandle, BirdeyeTrade } from "../birdeye/types";
import { buildLedgerEvents, calculateLedger, type LedgerEvent } from "../pnl/ledger";
import type { BoardRow } from "./analyze-token";

/** 2021-01-01. Balance changes are read from here so pre-trade transfers are not lost. */
export const HISTORY_FLOOR = 1_609_459_200;

// Token Transactions V3 requires both bounds once either is sent and rejects
// spans over 30 days. Without bounds it does not page back through a busy
// token's history (BONK returned zero rows for a wallet with 68 trades).
const TRADE_WINDOW_SECONDS = 29 * 86_400;

export const tradeKey = (item: BirdeyeTrade) =>
  `${item.tx_hash}:${item.ins_index ?? -1}:${item.inner_ins_index ?? -1}`;

export function chooseInterval(span: number): string {
  if (span <= 6 * 3_600) return "1m";
  if (span <= 2 * 86_400) return "5m";
  if (span <= 7 * 86_400) return "15m";
  if (span <= 30 * 86_400) return "1H";
  if (span <= 180 * 86_400) return "4H";
  return "1D";
}

export function candleLookup(candles: BirdeyeCandle[]) {
  const ordered = [...candles].sort((a, b) => a.unixTime - b.unixTime);
  return (timestamp: number) => {
    let lo = 0;
    let hi = ordered.length - 1;
    let answer = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((ordered[mid]?.unixTime ?? 0) <= timestamp) {
        answer = ordered[mid]?.c ?? answer;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return answer || ordered[0]?.c || 0;
  };
}

export interface WalletHistory {
  changes: BirdeyeBalanceChange[];
  trades: BirdeyeTrade[];
  truncated: boolean;
  requests: number;
}

/**
 * Every mint-filtered balance change for the wallet, then decoded swaps for
 * only the 29-day buckets that contain a change. A swap always moves the
 * wallet's token balance, so empty months cost nothing.
 */
/**
 * Float residue left after many transfers (2.8e-8 of a 112M-token position)
 * is not a position: it would read as "still holding" on the card.
 */
export function settledHolding(quantity: number, events: LedgerEvent[]): number {
  const scale = events.reduce((largest, event) => Math.max(largest, Math.abs(event.quantity)), 1);
  return Math.abs(quantity) <= scale * 1e-9 ? 0 : quantity;
}

export async function crawlWalletHistory(options: {
  client: BirdeyeClient;
  mint: string;
  wallet: string;
  from: number;
  to: number;
  maxEvents: number;
  expectedTrades?: number;
}): Promise<WalletHistory> {
  const { client, mint, wallet, from, to, maxEvents } = options;
  const expected = Math.max(0, options.expectedTrades ?? 0);
  const changes = await crawlOffsetWindows<BirdeyeBalanceChange>({
    from,
    to,
    maxItems: maxEvents,
    // Fetch every page the trade count predicts at once (the client's gate
    // still caps concurrency); paging one by one made 10k-trade wallets slow.
    prefetchPages: Math.min(100, Math.max(1, Math.ceil(expected / 100) + 2)),
    fetchPage: (start, end, offset, limit) =>
      client.balanceChangesPage(wallet, mint, start, end, offset, limit),
    key: (item) => `${item.tx_hash}:${item.token_account ?? ""}`,
  });

  const bucketCounts = new Map<number, number>();
  for (const change of changes.items) {
    if (change.block_unix_time < from || change.block_unix_time > to) continue;
    const bucket = Math.floor(change.block_unix_time / TRADE_WINDOW_SECONDS);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const tradeCrawls = await Promise.all(
    [...bucketCounts].map(([bucket, changeCount]) =>
      crawlOffsetWindows<BirdeyeTrade>({
        from: Math.max(from, bucket * TRADE_WINDOW_SECONDS),
        to: Math.min(to, (bucket + 1) * TRADE_WINDOW_SECONDS - 1),
        maxItems: maxEvents,
        prefetchPages: Math.min(25, Math.max(1, Math.ceil(changeCount / 100) + 1)),
        fetchPage: (start, end, offset, limit) =>
          client.tokenWalletTradesPage(mint, wallet, start, end, offset, limit),
        key: tradeKey,
      }),
    ),
  );
  const trades = new Map<string, BirdeyeTrade>();
  for (const crawl of tradeCrawls) {
    for (const item of crawl.items) trades.set(tradeKey(item), item);
  }

  return {
    changes: changes.items,
    trades: [...trades.values()],
    truncated: changes.truncated || tradeCrawls.some((crawl) => crawl.truncated),
    requests: changes.requests + tradeCrawls.reduce((sum, crawl) => sum + crawl.requests, 0),
  };
}

export function auditConfidence(input: {
  truncated: boolean;
  exact: number;
  unknown: number;
  reconcile: number;
  holding: number;
}): { confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = [];
  const scale = Math.max(Math.abs(input.holding), 1);
  const reconcileRatio = Math.abs(input.reconcile) / scale;
  if (input.truncated) reasons.push("history reached the configured event ceiling");
  if (input.exact < 0.95) reasons.push(`${Math.round((1 - input.exact) * 100)}% of traded quantity used fallback pricing`);
  if (input.unknown > 0.05) reasons.push(`${Math.round(input.unknown * 100)}% of open inventory has unknown basis`);
  if (reconcileRatio > 0.01) reasons.push("reconstructed quantity does not reconcile to Birdeye holding");

  if (!input.truncated && input.exact >= 0.95 && input.unknown <= 0.05 && reconcileRatio <= 0.01) {
    return { confidence: "high", reasons };
  }
  if (!input.truncated && input.exact >= 0.75 && input.unknown <= 0.2 && reconcileRatio <= 0.05) {
    return { confidence: "medium", reasons };
  }
  return { confidence: "low", reasons };
}

/**
 * Rebuild one wallet/token pair from its full balance history and grade it
 * against the Birdeye WAC row. Shared by the board audit and the video replay
 * so both report the same number for the same wallet.
 */
export async function auditWalletRow(options: {
  client: BirdeyeClient;
  mint: string;
  row: BoardRow;
  to: number;
  spotPriceUsd: number;
  maxEvents: number;
  candles?: BirdeyeCandle[];
}): Promise<{ row: BoardRow; requests: number }> {
  const { client, mint, row, to, maxEvents } = options;
  const history = await crawlWalletHistory({
    client,
    mint,
    wallet: row.wallet,
    from: HISTORY_FLOOR,
    to,
    maxEvents,
    expectedTrades: row.buys + row.sells,
  });

  const build = (candles?: BirdeyeCandle[]) => buildLedgerEvents({
    mint,
    balanceChanges: history.changes,
    trades: history.trades,
    // Balance deltas already identify unmatched movements as transfers. The
    // transfer endpoint only adds counterparty labels, not accounting inputs.
    transfers: [],
    fallbackPrice: candles && candles.length > 0 ? candleLookup(candles) : undefined,
  });
  let events = build(options.candles);
  let requests = history.requests;
  const unpricedTrade = events.some((event) =>
    (event.kind === "buy" || event.kind === "sell") && !(event.priceUsd > 0),
  );
  if (unpricedTrade && !options.candles && events.length > 0) {
    // Only fetch fallback marks when a swap has no execution price; otherwise
    // the ledger never reads them.
    const first = events[0]!.timestamp - 3_600;
    const candles = await client.ohlcv(mint, first, to, chooseInterval(to - first));
    requests += 1;
    events = build(candles);
  }

  const spot = options.spotPriceUsd > 0
    ? options.spotPriceUsd
    : options.candles?.at(-1)?.c ?? (row.holding > 0 ? row.unrealizedUsd / row.holding : 0);
  const ledger = calculateLedger(events, spot);
  const reconcile = ledger.quantity - row.holding;
  const judged = auditConfidence({
    truncated: history.truncated,
    exact: ledger.exactExecutionRatio,
    unknown: ledger.unknownBasisRatio,
    reconcile,
    holding: row.holding,
  });

  return {
    requests,
    row: {
      ...row,
      source: "audited-ledger",
      realizedUsd: ledger.realizedUsd,
      unrealizedUsd: ledger.unrealizedUsd,
      totalUsd: ledger.totalUsd,
      holding: settledHolding(ledger.quantity, events),
      boughtUsd: ledger.boughtUsd,
      soldUsd: ledger.soldUsd,
      buys: ledger.buys,
      sells: ledger.sells,
      audit: {
        ...judged,
        birdeyeTotalUsd: row.totalUsd,
        deltaUsd: ledger.totalUsd - row.totalUsd,
        reconciledQuantityDelta: reconcile,
        exactExecutionRatio: ledger.exactExecutionRatio,
        unknownBasisRatio: ledger.unknownBasisRatio,
        truncated: history.truncated,
        eventCount: events.length,
        spotPriceUsd: spot,
        ledger,
      },
    },
  };
}
