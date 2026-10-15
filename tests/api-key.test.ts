import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextResponse } from "next/server";
import { API_KEY_HEADER } from "../src/lib/api-client";
import { resolveApiKey, upstreamError } from "../src/server/api-key";
import { BirdeyeClient, BirdeyeError } from "../src/server/birdeye/client";

const VISITOR = "visitorKey0123456789abcdef";
const SERVER = "serverKey0123456789abcdef0";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BIRDEYE_API_KEY;
});

const withKey = (key?: string) =>
  new Request("http://localhost/api/analyze", { headers: key ? { [API_KEY_HEADER]: key } : {} });

test("a visitor's key wins over the server key; the server key is the fallback", () => {
  process.env.BIRDEYE_API_KEY = SERVER;
  assert.deepEqual(resolveApiKey(withKey(VISITOR)), { key: VISITOR, source: "visitor" });
  assert.deepEqual(resolveApiKey(withKey()), { key: SERVER, source: "server" });
});

test("no key anywhere asks for one; a malformed key is refused", async () => {
  const missing = resolveApiKey(withKey());
  assert.ok(missing instanceof NextResponse);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "api_key_required");
  const malformed = resolveApiKey(withKey("not a key!"));
  assert.ok(malformed instanceof NextResponse);
  assert.equal(malformed.status, 400);
});

test("a key Birdeye rejects becomes an actionable 401", async () => {
  const response = upstreamError(new BirdeyeError("Birdeye 401: invalid key", 401, "/defi/price"), "failed");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "api_key_rejected");
});

test("cached Birdeye responses never cross from one key to another", async () => {
  process.env.CACHE_TTL_SECONDS = "300";
  const seen: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get("x-api-key") ?? "");
    return new Response(JSON.stringify({ data: { value: 1 } }), { status: 200 });
  }) as typeof fetch;
  const mint = "CacheIsolationMint1111111111111111111111111";
  await new BirdeyeClient(VISITOR).tokenPrice(mint);
  await new BirdeyeClient(VISITOR).tokenPrice(mint);
  await new BirdeyeClient(SERVER).tokenPrice(mint);
  assert.deepEqual(seen, [VISITOR, SERVER], "same key reuses the cache, a different key fetches its own");
});
