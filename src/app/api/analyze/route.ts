import { NextResponse } from "next/server";
import { analyzeToken } from "@/server/services/analyze-token";
import { demoAnalysis, isDemoMint } from "@/server/demo";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { rateLimited } from "@/server/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  const audit = Number(params.get("audit") ?? process.env.AUDIT_WALLETS ?? 8);

  if (params.get("demo") === "1") return NextResponse.json(demoAnalysis(isDemoMint(mint) ? mint : undefined));

  const limited = rateLimited(request, "analyze");
  if (limited) return limited;

  if (!SOLANA_ADDRESS.test(mint)) {
    return NextResponse.json({ error: "A valid Solana mint is required." }, { status: 400 });
  }
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;

  try {
    return NextResponse.json({ ...(await analyzeToken(mint, audit, resolved.key)), keySource: resolved.source });
  } catch (error) {
    console.error("token analysis failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Token analysis failed.");
  }
}
