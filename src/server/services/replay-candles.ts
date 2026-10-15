import { BirdeyeClient } from "../birdeye/client";
import type { BirdeyeCandle } from "../birdeye/types";
import {
  expectedCandleCount,
  MAX_REPLAY_CANDLES,
  TIMEFRAME_SECONDS,
  type ReplayTimeframe,
} from "../../lib/replay-timeframe";

const CANDLES_PER_REQUEST = 4_000;

export async function replayCandles(options: {
  mint: string;
  from: number;
  to: number;
  timeframe: ReplayTimeframe;
  /** Defaults to the deployment's BIRDEYE_API_KEY. */
  apiKey?: string;
}): Promise<BirdeyeCandle[]> {
  const { mint, from, to, timeframe } = options;
  if (expectedCandleCount(from, to, timeframe) > MAX_REPLAY_CANDLES) {
    throw new Error(`This timeframe exceeds the ${MAX_REPLAY_CANDLES.toLocaleString()}-candle replay limit.`);
  }

  const client = new BirdeyeClient(options.apiKey ?? process.env.BIRDEYE_API_KEY ?? "");
  const seconds = TIMEFRAME_SECONDS[timeframe];
  const windows: Array<{ from: number; to: number }> = [];
  for (let start = from; start < to;) {
    const end = Math.min(to, start + (CANDLES_PER_REQUEST - 1) * seconds);
    windows.push({ from: start, to: end });
    start = end;
  }
  if (windows.length === 0) windows.push({ from, to });

  const pages = await Promise.all(windows.map((window) =>
    client.ohlcv(mint, window.from, window.to, timeframe),
  ));
  const unique = new Map<number, BirdeyeCandle>();
  for (const candle of pages.flat()) {
    if (candle.unixTime >= from && candle.unixTime <= to) unique.set(candle.unixTime, candle);
  }
  return [...unique.values()].sort((a, b) => a.unixTime - b.unixTime);
}
