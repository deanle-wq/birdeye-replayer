import type { BirdeyeCandle } from "@/server/birdeye/types";

export type ChartAxis = "price" | "mcap";

export interface ChartResultMetrics {
  axis: ChartAxis;
  open: number;
  close: number;
  high: number;
  volumeUsd: number;
  change: number;
  from: number;
  to: number;
}

/** Final-window figures shared by the preview and exported result card. */
export function chartResultMetrics(
  candles: BirdeyeCandle[],
  axis: ChartAxis,
  circulatingSupply?: number,
): ChartResultMetrics | null {
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last) return null;

  const useMarketCap = axis === "mcap" && Number.isFinite(circulatingSupply) && (circulatingSupply ?? 0) > 0;
  const multiplier = useMarketCap ? circulatingSupply! : 1;
  const openPrice = first.o || first.c;
  const closePrice = last.c;

  return {
    axis: useMarketCap ? "mcap" : "price",
    open: openPrice * multiplier,
    close: closePrice * multiplier,
    high: Math.max(...candles.map((candle) => candle.h)) * multiplier,
    volumeUsd: candles.reduce((sum, candle) => sum + (candle.v_usd ?? candle.v * candle.c), 0),
    change: openPrice > 0 ? closePrice / openPrice - 1 : 0,
    from: first.unixTime,
    to: last.unixTime,
  };
}
