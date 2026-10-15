import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { API_KEY_HEADER } from "@/lib/api-client";
import { BirdeyeError } from "./birdeye/client";

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type ApiKeySource = "visitor" | "server";

/**
 * The key a request spends: the visitor's own key when they sent one, else the
 * deployment's BIRDEYE_API_KEY. A public deployment can leave the server key
 * unset so every visitor brings their own.
 */
export function resolveApiKey(request: Request): { key: string; source: ApiKeySource } | NextResponse {
  const supplied = request.headers.get(API_KEY_HEADER)?.trim();
  if (supplied) {
    if (!KEY_PATTERN.test(supplied)) {
      return NextResponse.json({ error: "That does not look like a Birdeye Data API key.", code: "api_key_invalid" }, { status: 400 });
    }
    return { key: supplied, source: "visitor" };
  }
  const server = process.env.BIRDEYE_API_KEY?.trim();
  if (server) return { key: server, source: "server" };
  return NextResponse.json(
    { error: "Add your Birdeye Data API key to run a live analysis.", code: "api_key_required" },
    { status: 401 },
  );
}

/** A short, non-reversible tag so caches never share results across keys. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/** Turn Birdeye auth and rate errors into answers a visitor can act on. */
export function upstreamError(error: unknown, fallback: string): NextResponse {
  if (error instanceof BirdeyeError && (error.status === 401 || error.status === 403)) {
    return NextResponse.json(
      { error: "Birdeye rejected this API key, or its plan does not include this endpoint.", code: "api_key_rejected" },
      { status: 401 },
    );
  }
  if (error instanceof BirdeyeError && error.status === 429) {
    return NextResponse.json({ error: "Birdeye rate limit reached for this key. Try again shortly." }, { status: 429 });
  }
  if (error instanceof BirdeyeError) {
    // The raw message is "Birdeye 400: {json}"; show Birdeye's own words, not the JSON.
    const body = error.message.replace(/^Birdeye \d+:\s*/, "");
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { message?: unknown };
      if (typeof parsed.message === "string") detail = parsed.message;
    } catch {
      detail = body.length <= 120 ? body : "";
    }
    return NextResponse.json(
      { error: `${fallback.replace(/\.$/, "")}: Birdeye Data returned an error${detail ? ` (${detail})` : ""}. Try again in a moment.` },
      { status: 502 },
    );
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
