import { NextResponse } from "next/server";
import { TAG_LAYERS, type TagLayer } from "@/lib/chart-tags";
import { expectedCandleCount, isReplayTimeframe, MAX_REPLAY_CANDLES } from "@/lib/replay-timeframe";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { demoTags } from "@/server/demo-chart";
import { rateLimited } from "@/server/guard";
import { chartTags } from "@/server/services/chart-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Tag layers for one replay window: big trades, smart money, KOLs, snipers, dev. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  const timeframe = params.get("timeframe") ?? "";
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  const layers = (params.get("layers") ?? "").split(",").filter((layer): layer is TagLayer => TAG_LAYERS.includes(layer as TagLayer));
  const minUsd = Number(params.get("minUsd"));
  const volumeUsd = Number(params.get("volume"));
  if (!isReplayTimeframe(timeframe) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || layers.length === 0) {
    return NextResponse.json({ error: "Valid timeframe, from, to and at least one layer are required." }, { status: 400 });
  }
  if (expectedCandleCount(from, to, timeframe) > MAX_REPLAY_CANDLES) {
    return NextResponse.json({ error: "This window is too long for the timeframe." }, { status: 400 });
  }
  if (params.get("demo") === "1") return NextResponse.json(demoTags(from, to, timeframe, layers, minUsd > 0 ? minUsd : undefined));

  const limited = rateLimited(request, "tags");
  if (limited) return limited;
  if (!SOLANA_ADDRESS.test(mint)) return NextResponse.json({ error: "A valid Solana token mint is required." }, { status: 400 });
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;
  try {
    const result = await chartTags({
      mint,
      from,
      to,
      timeframe,
      layers,
      minUsd: minUsd > 0 ? minUsd : undefined,
      volumeUsd: volumeUsd > 0 ? volumeUsd : undefined,
      names: params.get("names") === "1",
    }, resolved.key);
    return NextResponse.json({ ...result, keySource: resolved.source });
  } catch (error) {
    console.error("chart tags failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Tag lookup failed.");
  }
}
