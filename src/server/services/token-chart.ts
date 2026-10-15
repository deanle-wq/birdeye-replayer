import { cleanSymbol } from "@/lib/symbol";
import { expectedCandleCount, REPLAY_TIMEFRAMES, type ReplayTimeframe } from "@/lib/replay-timeframe";
import { BirdeyeClient } from "../birdeye/client";
import type { BirdeyeCandle } from "../birdeye/types";
import type { ApiUsage } from "../birdeye/usage";
import { cached } from "./cache";

/** Earliest time the app asks Birdeye about: 2021-01-01. */
export const HISTORY_FLOOR = 1_609_459_200;
/** The range picker's overview chart: the finest bars that fit this many. */
const HISTORY_CANDLES = 1_500;

export interface TokenChart {
  demo?: boolean;
  token: { mint: string; name?: string; symbol?: string; logo?: string; decimals?: number };
  spotPriceUsd: number;
  market?: { circulatingSupply: number; marketCapUsd: number; holders: number };
  /** First candle Birdeye has for the token, and now. */
  bounds: { from: number; to: number };
  /** The whole history at `historyTimeframe`, for the range picker. */
  history: BirdeyeCandle[];
  historyTimeframe: ReplayTimeframe;
  generatedAt: number;
  usage?: ApiUsage;
  keySource?: "visitor" | "server";
}

export function historyTimeframe(from: number, to: number): ReplayTimeframe {
  return REPLAY_TIMEFRAMES.find((timeframe) => expectedCandleCount(from, to, timeframe) <= HISTORY_CANDLES) ?? "1D";
}

async function tokenChartUncached(mint: string, apiKey: string): Promise<TokenChart> {
  const client = new BirdeyeClient(apiKey);
  const now = Math.floor(Date.now() / 1_000);
  const [metadata, priceUsd, market, daily] = await Promise.all([
    client.tokenMetadata(mint),
    client.tokenPrice(mint),
    client.tokenMarketData(mint).catch(() => null),
    // Daily bars from the floor show where the token's history starts.
    client.ohlcv(mint, HISTORY_FLOOR, now, "1D"),
  ]);
  if (daily.length === 0) throw new Error("Birdeye has no trading history for this token.");
  const coarse = historyTimeframe(daily[0]!.unixTime, now);
  // A young token gets finer bars; its first bar also pins the launch time.
  const history = coarse === "1D" ? daily : await client.ohlcv(mint, daily[0]!.unixTime, now, coarse);
  const candles = history.length > 1 ? history : daily;
  return {
    token: { mint, name: metadata?.name, symbol: cleanSymbol(metadata?.symbol), logo: metadata?.logo_uri, decimals: metadata?.decimals },
    spotPriceUsd: priceUsd > 0 ? priceUsd : candles.at(-1)?.c ?? 0,
    market: market ?? undefined,
    bounds: { from: candles[0]!.unixTime, to: now },
    history: candles,
    historyTimeframe: candles === daily ? "1D" : coarse,
    generatedAt: now,
    usage: client.usage(),
  };
}

export function tokenChart(mint: string, apiKey = process.env.BIRDEYE_API_KEY ?? ""): Promise<TokenChart> {
  return cached(apiKey, `chart:${mint}`, () => tokenChartUncached(mint, apiKey));
}
