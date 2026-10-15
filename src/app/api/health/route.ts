import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    provider: "birdeye",
    configured: Boolean(process.env.BIRDEYE_API_KEY),
    // Visitors can always paste their own key; it takes precedence over the server's.
    acceptsVisitorKey: true,
    features: ["chart", "pnl"],
    methodology: "wac+balance-reconciliation",
    layers: ["big", "smart_trader", "kol", "sniper", "dev"],
  });
}
