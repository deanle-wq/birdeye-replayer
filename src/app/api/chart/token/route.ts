import { NextResponse } from "next/server";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { demoChart } from "@/server/demo-chart";
import { rateLimited } from "@/server/guard";
import { tokenChart } from "@/server/services/token-chart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Token metadata, market data and its whole history for the range picker. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("demo") === "1") return NextResponse.json(demoChart());
  const limited = rateLimited(request, "chart-token");
  if (limited) return limited;
  const mint = params.get("mint")?.trim() ?? "";
  if (!SOLANA_ADDRESS.test(mint)) return NextResponse.json({ error: "A valid Solana token mint is required." }, { status: 400 });
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;
  try {
    return NextResponse.json({ ...(await tokenChart(mint, resolved.key)), keySource: resolved.source });
  } catch (error) {
    console.error("token chart failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Token lookup failed.");
  }
}
