import { NextResponse } from "next/server";
import { expectedCandleCount, isReplayTimeframe, MAX_REPLAY_CANDLES } from "@/lib/replay-timeframe";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { demoCandles } from "@/server/demo-chart";
import { rateLimited } from "@/server/guard";
import { replayCandles } from "@/server/services/replay-candles";

export const runtime = "nodejs";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  const timeframe = params.get("timeframe") ?? "";
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  if ((params.get("demo") !== "1" && !SOLANA_ADDRESS.test(mint)) || !isReplayTimeframe(timeframe) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from) {
    return NextResponse.json({ error: "Valid mint, timeframe, from and to are required." }, { status: 400 });
  }
  if (expectedCandleCount(from, to, timeframe) > MAX_REPLAY_CANDLES) {
    return NextResponse.json({ error: `This timeframe exceeds the ${MAX_REPLAY_CANDLES.toLocaleString()}-candle replay limit.` }, { status: 400 });
  }
  // Sample candles are synthetic and free, so only live requests count.
  if (params.get("demo") === "1") return NextResponse.json({ timeframe, candles: demoCandles(from, to, timeframe) });
  // Timeframe switches fetch candles often; allow more of these per minute.
  const limited = rateLimited(request, "ohlcv", 3);
  if (limited) return limited;
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;

  try {
    return NextResponse.json({ timeframe, candles: await replayCandles({ mint, from, to, timeframe, apiKey: resolved.key }) });
  } catch (error) {
    return upstreamError(error, "OHLCV request failed.");
  }
}
