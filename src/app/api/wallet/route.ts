import { NextResponse } from "next/server";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { demoWallet } from "@/server/demo";
import { rateLimited } from "@/server/guard";
import { walletPortfolio } from "@/server/services/wallet-portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("demo") === "1") return NextResponse.json(demoWallet());

  const limited = rateLimited(request, "wallet");
  if (limited) return limited;

  const wallet = params.get("wallet")?.trim() ?? "";
  if (!SOLANA_ADDRESS.test(wallet)) {
    return NextResponse.json({ error: "A valid Solana wallet address is required." }, { status: 400 });
  }
  const offset = Math.max(0, Math.min(10_000, Math.floor(Number(params.get("offset") ?? 0)) || 0));
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;

  try {
    // Later pages repeat the window the first page settled on.
    const window = params.get("window") === "90d" ? "90d" : "all";
    return NextResponse.json({ ...(await walletPortfolio(wallet, offset, resolved.key, window)), keySource: resolved.source });
  } catch (error) {
    console.error("wallet portfolio failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Wallet lookup failed.");
  }
}
