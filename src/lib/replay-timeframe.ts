import type { BirdeyeCandle } from "@/server/birdeye/types";

export const REPLAY_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W"] as const;
export type ReplayTimeframe = (typeof REPLAY_TIMEFRAMES)[number];
/** A wallet replay stops at daily candles; weekly bars only suit a token's whole history. */
export const WALLET_TIMEFRAMES = REPLAY_TIMEFRAMES.filter((timeframe) => timeframe !== "1W");

export const TIMEFRAME_SECONDS: Record<ReplayTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1_800,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
  "1W": 604_800,
};

// A full replay may need more than one Birdeye request, but should stay
// bounded enough for both the editor and frame-by-frame video export.
export const MAX_REPLAY_CANDLES = 8_000;

export function isReplayTimeframe(value: string | undefined): value is ReplayTimeframe {
  return REPLAY_TIMEFRAMES.some((timeframe) => timeframe === value);
}

export function expectedCandleCount(from: number, to: number, timeframe: ReplayTimeframe): number {
  return Math.ceil(Math.max(0, to - from) / TIMEFRAME_SECONDS[timeframe]) + 1;
}

/** A candle's timestamp marks its OPEN; trades inside it belong to that bar. */
export function candleIndexAtOrBefore(candles: Pick<BirdeyeCandle, "unixTime">[], timestamp: number): number {
  if (candles.length === 0 || timestamp < candles[0]!.unixTime) return -1;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (candles[mid]!.unixTime <= timestamp) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Demo data can be widened locally; finer bars must come from real OHLCV. */
export function coarsenCandles(candles: BirdeyeCandle[], timeframe: ReplayTimeframe): BirdeyeCandle[] {
  const seconds = TIMEFRAME_SECONDS[timeframe];
  const result: BirdeyeCandle[] = [];
  for (const candle of candles) {
    const unixTime = Math.floor(candle.unixTime / seconds) * seconds;
    const last = result.at(-1);
    if (!last || last.unixTime !== unixTime) {
      result.push({ ...candle, unixTime, type: timeframe });
      continue;
    }
    last.h = Math.max(last.h, candle.h);
    last.l = Math.min(last.l, candle.l);
    last.c = candle.c;
    last.v += candle.v;
  }
  return result;
}
