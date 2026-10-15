import type { BirdeyeCandle } from "@/server/birdeye/types";
import type { LedgerEvent } from "@/server/pnl/ledger";
import {
  candleIndexAtOrBefore,
  WALLET_TIMEFRAMES,
  TIMEFRAME_SECONDS,
  type ReplayTimeframe,
} from "./replay-timeframe";

/** Bars of context drawn before the first fill and after the last one. */
export const PAD_BARS = 30;
/** Finest default bar that keeps a wallet's own span near this many candles. */
export const TARGET_REPLAY_BARS = 480;
/**
 * A position below this share of everything that ever arrived is dust. Its
 * replay ends at the last fill instead of dragging the clip to today.
 */
export const OPEN_RATIO = 0.01;
const REPLAY_FLOOR = 1_609_459_200;

export interface WalletActivity {
  firstTs: number;
  lastTs: number;
  /** Still in the token, so the replay must run to now and mark at spot. */
  holding: boolean;
}

export interface ReplayRange {
  from: number;
  to: number;
}

const isFill = (event: LedgerEvent) => event.kind === "buy" || event.kind === "sell";

/**
 * The wallet's own trading span. Transfers do not stretch it — an airdrop two
 * years before the first trade would otherwise turn every bar into a day.
 */
export function walletActivity(input: {
  events: LedgerEvent[];
  holding: number;
  firstTradeAt?: number;
  lastTradeAt?: number;
  /**
   * Widen the span to the Top Traders timestamps. Only for sampled events,
   * which read the newest page of each window and so start late; a full
   * ledger is the better witness of when the wallet actually traded.
   */
  widenToHints?: boolean;
}): WalletActivity | null {
  const fills = input.events.filter(isFill);
  const timed = fills.length > 0 ? fills : input.events;
  const hintFirst = input.firstTradeAt;
  const hintLast = input.lastTradeAt ?? input.firstTradeAt;
  let firstTs = timed.length > 0 ? Math.min(...timed.map((event) => event.timestamp)) : hintFirst;
  let lastTs = timed.length > 0 ? Math.max(...timed.map((event) => event.timestamp)) : hintLast;
  if (input.widenToHints && timed.length > 0) {
    if (hintFirst) firstTs = Math.min(firstTs!, hintFirst);
    if (hintLast) lastTs = Math.max(lastTs!, hintLast);
  }
  if (!firstTs || !lastTs) return null;
  const everHeld = input.events
    .filter((event) => event.kind === "buy" || event.kind === "transfer_in")
    .reduce((sum, event) => sum + event.quantity, 0);
  const holding = everHeld > 0 ? input.holding / everHeld > OPEN_RATIO : input.holding > 0;
  return { firstTs, lastTs: Math.max(firstTs, lastTs), holding };
}

export function activityUntil(activity: WalletActivity, now: number): number {
  return activity.holding ? Math.max(now, activity.lastTs) : activity.lastTs;
}

/** Finest timeframe whose bar count for the wallet's span stays readable. */
export function defaultWalletTimeframe(activity: WalletActivity, now: number): ReplayTimeframe {
  return timeframeForSpan(activityUntil(activity, now) - activity.firstTs);
}

/** The finest timeframe that keeps a span within the replay's bar budget. */
export function timeframeForSpan(seconds: number): ReplayTimeframe {
  const span = Math.max(seconds, 60);
  return WALLET_TIMEFRAMES.find((timeframe) => span / TIMEFRAME_SECONDS[timeframe] <= TARGET_REPLAY_BARS) ?? "1D";
}

/**
 * Chart range for one wallet: its first fill to its last (or to now while it
 * still holds), padded so the clip opens before the entry and lands after the
 * exit. Padding is measured in bars, so a coarser timeframe shows more context.
 */
export function walletReplayWindow(activity: WalletActivity, timeframe: ReplayTimeframe, now: number): ReplayRange {
  const seconds = TIMEFRAME_SECONDS[timeframe];
  const pad = PAD_BARS * seconds;
  const from = Math.max(REPLAY_FLOOR, Math.floor((activity.firstTs - pad) / seconds) * seconds);
  const to = Math.min(now, activityUntil(activity, now) + pad);
  return { from, to: Math.max(to, Math.min(now, from + seconds)) };
}

export interface EventBins {
  /**
   * Bar per event, parallel to the input. -1 happened before the first bar,
   * `candles.length` after the last; both still count toward running PnL.
   */
  bars: number[];
  fills: Map<number, { buy: LedgerEvent[]; sell: LedgerEvent[] }>;
  /** Buys and sells with a bar on this chart. */
  plotted: number;
  /** Buys and sells outside the charted range. */
  outside: number;
}

/**
 * Put every fill on a bar. Birdeye OHLCV omits empty bars, so a fill inside a
 * missing bar snaps to the nearest drawn one instead of disappearing.
 */
export function binEvents(
  events: LedgerEvent[],
  candles: Pick<BirdeyeCandle, "unixTime">[],
  timeframe: ReplayTimeframe,
  range?: ReplayRange,
): EventBins {
  const seconds = TIMEFRAME_SECONDS[timeframe];
  const fills: EventBins["fills"] = new Map();
  const bars: number[] = [];
  let plotted = 0;
  let outside = 0;
  const first = candles[0]?.unixTime;
  const last = candles.at(-1)?.unixTime;

  for (const event of events) {
    let bar: number;
    const t = event.timestamp;
    if (first === undefined || last === undefined) bar = -1;
    else if (t < first) bar = range && t >= range.from ? 0 : -1;
    else if (t >= last + seconds) bar = range && t <= range.to ? candles.length - 1 : candles.length;
    else {
      const index = candleIndexAtOrBefore(candles, t);
      const start = candles[index]!.unixTime;
      const next = candles[index + 1]?.unixTime;
      bar = t < start + seconds || next === undefined || t - (start + seconds) < next - t ? index : index + 1;
    }
    bars.push(bar);
    if (!isFill(event)) continue;
    if (bar < 0 || bar >= candles.length) {
      outside += 1;
      continue;
    }
    const held = fills.get(bar) ?? { buy: [], sell: [] };
    held[event.kind as "buy" | "sell"].push(event);
    fills.set(bar, held);
    plotted += 1;
  }
  return { bars, fills, plotted, outside };
}
