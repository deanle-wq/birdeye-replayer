import { createHash } from "node:crypto";

/** Promise cache keyed per API key, so one key's results never serve another. */
const store = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

export function cached<T>(apiKey: string, key: string, build: () => Promise<T>): Promise<T> {
  const full = `${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}:${key}`;
  const now = Date.now();
  const held = store.get(full);
  if (held && held.expiresAt > now) return held.value as Promise<T>;
  const ttlMs = Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1_000;
  const value = build();
  store.set(full, { expiresAt: now + ttlMs, value });
  value.catch(() => {
    if (store.get(full)?.value === value) store.delete(full);
  });
  if (store.size > 2_000) {
    for (const [stale, entry] of store) if (entry.expiresAt <= now) store.delete(stale);
  }
  return value;
}
