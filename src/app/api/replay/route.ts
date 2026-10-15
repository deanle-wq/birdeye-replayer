import { NextResponse } from "next/server";
import { resolveApiKey, upstreamError } from "@/server/api-key";
import { rateLimited } from "@/server/guard";
import { walletReplay } from "@/server/services/wallet-replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function optionalTime(value: string | null): number | undefined {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint")?.trim() ?? "";
  const wallet = params.get("wallet")?.trim() ?? "";
  const limited = rateLimited(request, "replay");
  if (limited) return limited;
  if (!SOLANA_ADDRESS.test(mint) || !SOLANA_ADDRESS.test(wallet)) {
    return NextResponse.json({ error: "A valid Solana mint and wallet are required." }, { status: 400 });
  }
  const resolved = resolveApiKey(request);
  if (resolved instanceof NextResponse) return resolved;
  try {
    return NextResponse.json(await walletReplay({
      mint,
      wallet,
      apiKey: resolved.key,
      // Hints from Top Traders; only the sampled path for very active wallets reads them.
      firstTradeAt: optionalTime(params.get("first")),
      lastTradeAt: optionalTime(params.get("last")),
    }));
  } catch (error) {
    console.error("wallet replay failed", error instanceof Error ? error.message : error);
    return upstreamError(error, "Replay data failed");
  }
}
