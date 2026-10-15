import { BirdeyeClient } from "../birdeye/client";
import type { BirdeyeBalanceChange, BirdeyeTrade } from "../birdeye/types";
import type { ApiUsage } from "../birdeye/usage";
import { buildLedgerEvents, buildTradeReplayEvents, type LedgerEvent } from "../pnl/ledger";
import { builtInRows, rowFromBuiltIn, type BoardRow } from "./analyze-token";
import { auditWalletRow, candleLookup, chooseInterval, HISTORY_FLOOR, tradeKey } from "./wallet-ledger";

const WINDOW_SECONDS = 29 * 86_400;
const MAX_SAMPLE_WINDOWS = 36;
/** Below this share of Birdeye's trade count, decoded swaps are too thin to trust as markers. */
const MIN_DECODED_COVERAGE = 0.25;

/** How much of the wallet's activity each source returned. */
export interface ReplayCoverage {
  /** Buys + sells in Birdeye's Wallet PnL for this wallet and token. */
  birdeyeTrades: number;
  /** Swaps Token Transactions V3 returned and matched. */
  decodedFills: number;
  /** Net balance changes read, one per transaction. */
  balanceEvents?: number;
}

interface ReplayBase {
  row: BoardRow;
  requests: number;
  elapsedMs: number;
  usage: ApiUsage;
  coverage: ReplayCoverage;
}

export type WalletReplay =
  | (ReplayBase & {
    /** Full balance-change ledger, graded the same way as the board audit. */
    mode: "ledger";
  })
  | (ReplayBase & {
    /** Wallet too active for a full read: decoded swaps only, Birdeye WAC totals. */
    mode: "sample";
    events: LedgerEvent[];
    sampled: boolean;
    windows: number;
    reason: string;
  })
  | (ReplayBase & {
    /**
     * Decoded swaps came back missing or far short of Birdeye's trade count,
     * so markers come from the wallet's balance changes (direction from the
     * sign, price from OHLCV) and PnL stays on Birdeye WAC.
     */
    mode: "inferred";
    events: LedgerEvent[];
    reason: string;
  });

/** Spread `count` picks across `items`, always keeping both ends. */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) =>
    items[Math.round((index / Math.max(count - 1, 1)) * (items.length - 1))]!,
  );
}

const isFill = (event: LedgerEvent) => event.kind === "buy" || event.kind === "sell";

/**
 * Turn balance movements into replay fills: tokens in read as a buy, tokens
 * out as a sell, each marked at the OHLCV close of its moment. Only used when
 * decoded swaps are missing, and always labelled as inferred.
 */
async function inferFills(client: BirdeyeClient, mint: string, events: LedgerEvent[], to: number): Promise<LedgerEvent[]> {
  if (events.length === 0) return [];
  const first = Math.max(HISTORY_FLOOR, events[0]!.timestamp - 3_600);
  const priceAt = candleLookup(await client.ohlcv(mint, first, to, chooseInterval(to - first)));
  return events.map((event) => {
    const priceUsd = event.priceUsd > 0 ? event.priceUsd : priceAt(event.timestamp);
    const kind = event.kind === "buy" || event.kind === "transfer_in" ? "buy" : "sell";
    return { ...event, kind, priceUsd, valueUsd: event.quantity * priceUsd, exactExecution: false };
  });
}

export async function walletReplay(options: {
  mint: string;
  wallet: string;
  firstTradeAt?: number;
  lastTradeAt?: number;
  /** Defaults to the deployment's BIRDEYE_API_KEY. */
  apiKey?: string;
}): Promise<WalletReplay> {
  const started = Date.now();
  const client = new BirdeyeClient(options.apiKey ?? process.env.BIRDEYE_API_KEY ?? "");
  // A video replays one wallet, so it can afford a deeper read than the
  // board audit. Measured on BONK: ~9.9k trades took ~90 s, so the default
  // stops at 7.5k (well under a minute) and heavier wallets are sampled.
  const maxEvents = Number(process.env.REPLAY_MAX_EVENTS ?? 25_000);
  const maxTrades = Number(process.env.REPLAY_MAX_TRADES ?? 7_500);
  const now = Math.floor(Date.now() / 1_000);
  const { mint, wallet } = options;
  const done = <T extends object>(result: T) => ({ ...result, elapsedMs: Date.now() - started, usage: client.usage() });

  // Same price URL as the board, so within the cache TTL both mark open
  // inventory at the identical spot.
  const [pnlResponse, spotPriceUsd] = await Promise.all([
    client.walletPnlMultiple(mint, [wallet]),
    client.tokenPrice(mint),
  ]);
  const baseline = rowFromBuiltIn(
    { owner: wallet, firstTradeUnixTime: options.firstTradeAt, lastTradeUnixTime: options.lastTradeAt },
    builtInRows(pnlResponse)[wallet] ?? {},
  );
  const expectedTrades = baseline.buys + baseline.sells;

  if (expectedTrades <= maxTrades) {
    const audited = await auditWalletRow({ client, mint, row: baseline, to: now, spotPriceUsd, maxEvents });
    const ledgerEvents = audited.row.audit?.ledger.events ?? [];
    const decodedFills = ledgerEvents.filter(isFill).length;
    const coverage = { birdeyeTrades: expectedTrades, decodedFills, balanceEvents: ledgerEvents.length };
    // Birdeye counts trades this wallet made, the balance history shows the
    // tokens moving, but Token Transactions returned few or none of them as
    // swaps. A ledger built on that would book paid buys as free transfers.
    if (expectedTrades >= 20 && decodedFills < expectedTrades * MIN_DECODED_COVERAGE && ledgerEvents.length > decodedFills) {
      return done({
        mode: "inferred" as const,
        row: baseline,
        events: await inferFills(client, mint, ledgerEvents, now),
        requests: audited.requests + 3,
        coverage,
        reason: `Birdeye reports ${expectedTrades.toLocaleString("en-US")} trades, but Token Transactions returned ${decodedFills.toLocaleString("en-US")} decoded swaps`,
      });
    }
    return done({ mode: "ledger" as const, row: audited.row, requests: audited.requests + 2, coverage });
  }

  // A wallet with thousands of fills cannot be read in full per click. Sample
  // its own active span (not the token's), and read each side separately so a
  // burst of buys can never push the sells out of the page. Top Traders'
  // last-trade time can lag, so the sample always runs to now.
  const to = now;
  const from = Math.max(HISTORY_FLOOR, Math.min(to, Math.floor((options.firstTradeAt ?? to - MAX_SAMPLE_WINDOWS * WINDOW_SECONDS) - 3_600)));
  const allWindows: Array<{ from: number; to: number }> = [];
  for (let end = to; end > from; end -= WINDOW_SECONDS) {
    allWindows.push({ from: Math.max(from, end - WINDOW_SECONDS + 1), to: end });
  }
  if (allWindows.length === 0) allWindows.push({ from, to });
  const windows = spread(allWindows, MAX_SAMPLE_WINDOWS);
  const pages = await Promise.all(
    windows.flatMap((window) => (["buy", "sell"] as const).map((side) =>
      client.tokenWalletTradesPage(mint, wallet, window.from, window.to, 0, 100, side),
    )),
  );
  const trades = new Map<string, BirdeyeTrade>();
  for (const page of pages) {
    for (const trade of page.items) trades.set(tradeKey(trade), trade);
  }
  const sampled = buildTradeReplayEvents([...trades.values()], mint);
  const limit = `${expectedTrades.toLocaleString("en-US")} Birdeye trades exceeds the ${maxTrades.toLocaleString("en-US")}-trade full-ledger limit`;

  if (sampled.length > 0) {
    return done({
      mode: "sample" as const,
      row: baseline,
      events: sampled,
      sampled: windows.length < allWindows.length || pages.some((page) => page.hasNext),
      windows: windows.length,
      requests: pages.length + 2,
      coverage: { birdeyeTrades: expectedTrades, decodedFills: sampled.length },
      reason: limit,
    });
  }

  // No decoded swaps in any sampled window: fall back to one page of balance
  // changes per window, which every wallet has whatever venue it traded on.
  const balancePages = await Promise.all(
    windows.map((window) => client.balanceChangesPage(wallet, mint, window.from, window.to, 0, 100)),
  );
  const changes: BirdeyeBalanceChange[] = balancePages.flatMap((page) => page.items);
  const balanceEvents = buildLedgerEvents({ mint, balanceChanges: changes, trades: [] });
  return done({
    mode: "inferred" as const,
    row: baseline,
    events: await inferFills(client, mint, balanceEvents, now),
    requests: pages.length + balancePages.length + 3,
    coverage: { birdeyeTrades: expectedTrades, decodedFills: 0, balanceEvents: balanceEvents.length },
    reason: `${limit}, and Token Transactions returned no decoded swaps in the sampled windows`,
  });
}
