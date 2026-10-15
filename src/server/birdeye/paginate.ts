import type { OffsetPage } from "./types";

export interface WindowCrawl<T> {
  items: T[];
  truncated: boolean;
  requests: number;
}

interface CrawlOptions<T> {
  from: number;
  to: number;
  fetchPage: (from: number, to: number, offset: number, limit: number) => Promise<OffsetPage<T>>;
  key: (item: T) => string;
  limit?: number;
  maxOffset?: number;
  maxItems?: number;
  maxWindowSpan?: number;
  prefetchPages?: number;
}

/**
 * Birdeye offset endpoints stop at 10,000. A time window that reaches that
 * ceiling is re-read as two smaller windows, so "10k" never silently means
 * "complete". A single second with more than the cap is the only irreducible
 * case and is surfaced as truncated.
 */
export async function crawlOffsetWindows<T>(options: CrawlOptions<T>): Promise<WindowCrawl<T>> {
  const limit = options.limit ?? 100;
  const maxOffset = options.maxOffset ?? 10_000;
  const maxItems = options.maxItems ?? 50_000;
  let requests = 0;

  async function window(from: number, to: number): Promise<WindowCrawl<T>> {
    if (options.maxWindowSpan && to - from > options.maxWindowSpan) {
      const mid = Math.floor((from + to) / 2);
      // The API client owns the concurrency gate, so independent time windows
      // can be scheduled together without exceeding the configured rate.
      const [left, right] = await Promise.all([
        window(from, mid),
        window(mid + 1, to),
      ]);
      const combined = [...left.items, ...right.items];
      return {
        items: combined.slice(0, maxItems),
        truncated: left.truncated || right.truncated || combined.length > maxItems,
        requests,
      };
    }

    const items: T[] = [];
    let nextOffset = 0;
    const prefetchPages = Math.min(
      options.prefetchPages ?? 1,
      Math.floor(maxOffset / limit),
    );
    if (prefetchPages > 1) {
      const pages = await Promise.all(
        Array.from({ length: prefetchPages }, (_, index) =>
          options.fetchPage(from, to, index * limit, limit),
        ),
      );
      requests += pages.length;
      for (const page of pages) {
        items.push(...page.items);
        if (items.length >= maxItems) {
          return { items: items.slice(0, maxItems), truncated: true, requests };
        }
        if (!page.hasNext || page.items.length === 0) {
          return { items, truncated: false, requests };
        }
      }
      nextOffset = prefetchPages * limit;
    }

    for (let offset = nextOffset; offset <= maxOffset - limit; offset += limit) {
      const page = await options.fetchPage(from, to, offset, limit);
      requests += 1;
      items.push(...page.items);
      if (items.length >= maxItems) {
        return { items: items.slice(0, maxItems), truncated: true, requests };
      }
      if (!page.hasNext || page.items.length === 0) {
        return { items, truncated: false, requests };
      }
    }

    if (from >= to) return { items, truncated: true, requests };
    const mid = Math.floor((from + to) / 2);
    const [left, right] = await Promise.all([
      window(from, mid),
      window(mid + 1, to),
    ]);
    return {
      items: [...left.items, ...right.items],
      truncated: left.truncated || right.truncated,
      requests,
    };
  }

  const result = await window(options.from, options.to);
  const unique = new Map<string, T>();
  for (const item of result.items) unique.set(options.key(item), item);
  return { ...result, items: [...unique.values()] };
}

export async function crawlCursor<T>(options: {
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>;
  key: (item: T) => string;
  maxItems?: number;
}): Promise<WindowCrawl<T>> {
  const maxItems = options.maxItems ?? 50_000;
  const unique = new Map<string, T>();
  let cursor: string | undefined;
  let requests = 0;
  let truncated = false;

  do {
    const page = await options.fetchPage(cursor);
    requests += 1;
    for (const item of page.items) unique.set(options.key(item), item);
    cursor = page.nextCursor;
    if (unique.size >= maxItems) {
      truncated = Boolean(cursor);
      break;
    }
  } while (cursor);

  return { items: [...unique.values()].slice(0, maxItems), truncated, requests };
}
