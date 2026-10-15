import { NextResponse } from "next/server";

const hits = new Map<string, number[]>();

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

/**
 * Best-effort per-IP limit for the routes that spend Birdeye compute units.
 * It counts per server instance, so on serverless it is a speed bump, not a
 * wall: pair it with SITE_PASSWORD or a Vercel Firewall rate-limit rule for a
 * hard cap. RATE_LIMIT_PER_MINUTE=0 turns it off.
 */
export function rateLimited(request: Request, bucket: string, multiplier = 1): NextResponse | null {
  const base = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
  if (!(base > 0)) return null;
  const limit = Math.max(1, Math.round(base * multiplier));
  const key = `${bucket}:${clientIp(request)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= limit) {
    return NextResponse.json(
      { error: "Too many requests from this address. Try again in a minute." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [stale, times] of hits) {
      if (times.every((time) => now - time >= 60_000)) hits.delete(stale);
    }
  }
  return null;
}
