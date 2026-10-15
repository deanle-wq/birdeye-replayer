import { NextResponse } from "next/server";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { demoAnalysis, isDemoMint } from "@/server/demo";
import { rateLimited } from "@/server/guard";
import { tokenContext } from "@/server/services/analyze-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A token's chart and prices without a trader board: what a wallet's video needs. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  if (params.get("demo") === "1") {
    return isDemoMint(mint)
      ? NextResponse.json(demoAnalysis(mint))
      : NextResponse.json({ error: "Not a sample token." }, { status: 404 });
  }

  const limited = rateLimited(request, "token");
  if (limited) return limited;

  if (!SOLANA_ADDRESS.test(mint)) {
    return NextResponse.json({ error: "A valid Solana mint is required." }, { status: 400 });
  }
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;

  try {
    return NextResponse.json({ ...(await tokenContext(mint, resolved.key)), keySource: resolved.source });
  } catch (error) {
    console.error("token context failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Token lookup failed.");
  }
}
