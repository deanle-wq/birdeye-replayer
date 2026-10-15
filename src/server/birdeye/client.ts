import type {
  BirdeyeBalanceChange,
  BirdeyeCandle,
  BirdeyeTokenMetadata,
  BirdeyeTopTrader,
  BirdeyeTrade,
  BirdeyeTransfer,
  CursorPage,
  OffsetPage,
} from "./types";
import { createHash } from "node:crypto";
import { UsageMeter, type ApiUsage } from "./usage";

type QueryValue = string | number | boolean | undefined;

class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await job();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export class BirdeyeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

export class BirdeyeClient {
  private static readonly responseCache = new Map<
    string,
    { expiresAt: number; value: Promise<unknown> }
  >();
  private readonly baseUrl: string;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly gate: Gate;
  private readonly meter = new UsageMeter();
  /** Cache partition: responses fetched with one key are never served to another. */
  private readonly keyTag: string;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("BIRDEYE_API_KEY is required");
    this.keyTag = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
    this.baseUrl = process.env.BIRDEYE_BASE_URL ?? "https://public-api.birdeye.so";
    this.retries = Number(process.env.BIRDEYE_MAX_RETRIES ?? 4);
    this.timeoutMs = Number(process.env.BIRDEYE_TIMEOUT_MS ?? 20_000);
    this.gate = new Gate(Math.max(1, Number(process.env.BIRDEYE_CONCURRENCY ?? 12)));
  }

  private url(path: string, query: Record<string, QueryValue> = {}): URL {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown } = {},
  ): Promise<T> {
    const url = this.url(path, options.query);
    const cacheKey = `${this.keyTag}:${method}:${url.toString()}:${JSON.stringify(options.body ?? null)}`;
    const now = Date.now();
    const cached = BirdeyeClient.responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.meter.hit();
      return cached.value as Promise<T>;
    }

    const value = this.gate.run(async () => {
      let last: unknown;
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        try {
          const response = await fetch(url, {
            method,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "x-api-key": this.apiKey,
              "x-chain": "solana",
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            cache: "no-store",
            signal: AbortSignal.timeout(this.timeoutMs),
          });

          if (response.ok) {
            const json = (await response.json()) as T;
            this.meter.record(path, url.searchParams, options.body, json);
            return json;
          }

          const detail = await response.text();
          const error = new BirdeyeError(
            `Birdeye ${response.status}: ${detail.slice(0, 300)}`,
            response.status,
            path,
          );
          if (response.status !== 429 && response.status < 500) throw error;
          last = error;

          const retryAfter = Number(response.headers.get("retry-after") ?? 0);
          const delay = retryAfter > 0 ? retryAfter * 1_000 : 300 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (error) {
          last = error;
          if (error instanceof BirdeyeError && error.status < 500 && error.status !== 429) {
            throw error;
          }
          if (attempt === this.retries) break;
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
        }
      }
      throw last instanceof Error ? last : new Error(`Birdeye request failed: ${path}`);
    });
    const ttlMs = Math.max(0, Number(process.env.CACHE_TTL_SECONDS ?? 300)) * 1_000;
    BirdeyeClient.responseCache.set(cacheKey, { expiresAt: now + ttlMs, value });
    try {
      return await value;
    } catch (error) {
      if (BirdeyeClient.responseCache.get(cacheKey)?.value === value) {
        BirdeyeClient.responseCache.delete(cacheKey);
      }
      throw error;
    }
  }

  /** Requests and compute units spent by this client instance. */
  usage(): ApiUsage {
    return this.meter.snapshot();
  }

  async tokenMetadata(mint: string): Promise<BirdeyeTokenMetadata | null> {
    const response = await this.request<{
      success?: boolean;
      data?: BirdeyeTokenMetadata;
    }>("GET", "/defi/v3/token/meta-data/single", { query: { address: mint } });
    return response.data ?? null;
  }

  /** Supply and market cap; the video derives entry market cap from it. */
  async tokenMarketData(mint: string): Promise<{ circulatingSupply: number; marketCapUsd: number; holders: number } | null> {
    const response = await this.request<{
      data?: { circulating_supply?: number; market_cap?: number; holder?: number };
    }>("GET", "/defi/v3/token/market-data", { query: { address: mint } });
    const data = response.data;
    if (!data) return null;
    return {
      circulatingSupply: Number(data.circulating_supply) || 0,
      marketCapUsd: Number(data.market_cap) || 0,
      holders: Number(data.holder) || 0,
    };
  }

  /** Name, symbol and logo for up to 20 mints in one call. */
  async tokenMetadataMultiple(mints: string[]): Promise<Record<string, BirdeyeTokenMetadata>> {
    if (mints.length === 0) return {};
    const response = await this.request<{ data?: Record<string, BirdeyeTokenMetadata | null> }>(
      "GET",
      "/defi/v3/token/meta-data/multiple",
      { query: { list_address: mints.join(",") } },
    );
    return Object.fromEntries(Object.entries(response.data ?? {}).filter((entry): entry is [string, BirdeyeTokenMetadata] => Boolean(entry[1])));
  }

  /** Every token a wallet traded, with WAC PnL per token, newest trade first. */
  async walletPnlDetails(wallet: string, offset = 0, limit = 100, duration: "all" | "90d" = "all"): Promise<unknown> {
    return this.request("POST", "/wallet/v2/pnl/details", {
      body: { wallet, duration, pnl_method: "wac", sort_by: "last_trade", sort_type: "desc", limit, offset },
    });
  }

  /** Current holdings with price, value and logo, largest first. */
  async walletPortfolio(wallet: string, limit = 100): Promise<unknown> {
    return this.request("GET", "/wallet/v2/current-net-worth", {
      query: { wallet, limit, offset: 0, sort_by: "value", sort_type: "desc" },
    });
  }

  /** Birdeye's label for an address; empty for most wallets. */
  async walletIdentity(wallet: string): Promise<unknown> {
    return this.request("GET", "/identity/v1/single", { query: { address: wallet } });
  }

  /** Tagged-wallet flow per bucket: dev, sniper, smart_trader and kol series. */
  async walletTagsTracker(mint: string, from: number, to: number, timeFrame: string, tags: readonly string[]): Promise<unknown> {
    return this.request("GET", "/token/v1/wallet-tags-tracker", {
      query: { token_address: mint, time_from: from, time_to: to, time_frame: timeFrame, tags: tags.join(",") },
    });
  }

  /** The tagged wallets behind each bucket, biggest first. */
  async walletTagsDetails(mint: string, from: number, to: number, timeFrame: string, tags: readonly string[], limitWallet = 3, limitBucket = 300): Promise<unknown> {
    return this.request("GET", "/token/v1/wallet-tags-tracker/details", {
      query: { token_address: mint, time_from: from, time_to: to, time_frame: timeFrame, tags: tags.join(","), limit_wallet: limitWallet, limit_bucket: limitBucket },
    });
  }

  /** Swaps at or above a USD size, oldest first. */
  async tradesByVolume(mint: string, from: number, to: number, minUsd: number, limit = 100, offset = 0): Promise<unknown> {
    return this.request("GET", "/defi/v3/token/txs-by-volume", {
      query: {
        token_address: mint,
        volume_type: "usd",
        min_volume: Math.round(minUsd),
        after_time: from,
        before_time: to,
        tx_type: "swap",
        sort_by: "block_unix_time",
        sort_type: "asc",
        limit,
        offset,
      },
    });
  }

  async tokenPrice(mint: string): Promise<number> {
    const response = await this.request<{
      success?: boolean;
      data?: { value?: number | string };
    }>("GET", "/defi/price", { query: { address: mint } });
    const value = Number(response.data?.value);
    return Number.isFinite(value) ? value : 0;
  }

  async ohlcv(
    mint: string,
    from: number,
    to: number,
    type = "1H",
  ): Promise<BirdeyeCandle[]> {
    const response = await this.request<{
      success?: boolean;
      data?: { items?: Array<Omit<BirdeyeCandle, "unixTime"> & { unix_time: number }> };
    }>("GET", "/defi/v3/ohlcv", {
      query: {
        address: mint,
        type,
        time_from: from,
        time_to: to,
        mode: "range",
        padding: false,
      },
    });
    return (response.data?.items ?? []).map(({ unix_time, ...item }) => ({
      ...item,
      unixTime: unix_time,
    }));
  }

  async topTraders(
    mint: string,
    sortBy: string,
    sortType: "asc" | "desc" = "desc",
    limit = 30,
  ): Promise<BirdeyeTopTrader[]> {
    const items: BirdeyeTopTrader[] = [];
    const pageSize = 10; // Endpoint maximum.
    for (let offset = 0; offset < limit; offset += pageSize) {
      const response = await this.request<{
        success?: boolean;
        data?: { items?: BirdeyeTopTrader[] };
      }>("GET", "/defi/v2/tokens/top_traders", {
        query: {
          address: mint,
          time_frame: "all_time",
          sort_by: sortBy,
          sort_type: sortType,
          offset,
          limit: Math.min(pageSize, limit - offset),
          ui_amount_mode: "scaled",
        },
      });
      const page = response.data?.items ?? [];
      items.push(...page);
      if (page.length < pageSize) break;
    }
    return items;
  }

  async walletPnlMultiple(mint: string, wallets: string[]): Promise<unknown> {
    return this.request("GET", "/wallet/v2/pnl/multiple", {
      query: {
        token_address: mint,
        wallets: wallets.join(","),
        pnl_method: "wac",
      },
    });
  }

  async traderTradesPage(
    wallet: string,
    from: number,
    to: number,
    offset: number,
    limit = 100,
  ): Promise<OffsetPage<BirdeyeTrade>> {
    const response = await this.request<{
      success?: boolean;
      data?: { items?: BirdeyeTrade[]; has_next?: boolean; hasNext?: boolean };
    }>("GET", "/trader/txs/seek_by_time", {
      query: {
        address: wallet,
        tx_type: "swap",
        // The live endpoint rejects requests that carry both bounds even
        // though the docs describe them as a pair. Results are newest-first,
        // so page backward from the upper bound and stop once a page crosses
        // the lower bound.
        before_time: to,
        offset,
        limit,
        ui_amount_mode: "scaled",
      },
    });
    const raw = response.data?.items ?? [];
    const crossedLowerBound = raw.some((item) => item.block_unix_time < from);
    const items = raw.filter(
      (item) => item.block_unix_time >= from && item.block_unix_time <= to,
    );
    return {
      items,
      hasNext:
        !crossedLowerBound &&
        (response.data?.has_next ?? response.data?.hasNext ?? raw.length === limit),
    };
  }

  async tokenWalletTradesPage(
    mint: string,
    wallet: string,
    from: number,
    to: number,
    offset: number,
    limit = 100,
    txType: "swap" | "buy" | "sell" = "swap",
  ): Promise<OffsetPage<BirdeyeTrade>> {
    const response = await this.request<{
      success?: boolean;
      data?: { items?: BirdeyeTrade[]; has_next?: boolean; hasNext?: boolean };
    }>("GET", "/defi/v3/token/txs", {
      query: {
        address: mint,
        owner: wallet,
        // `buy` and `sell` filter by side, which lets a sampled replay read
        // both sides of a busy window instead of only its newest buys.
        tx_type: txType,
        sort_by: "block_unix_time",
        sort_type: "desc",
        // This endpoint requires both bounds and accepts at most 30 days.
        before_time: to,
        after_time: from,
        offset,
        limit,
        ui_amount_mode: "scaled",
      },
    });
    const raw = response.data?.items ?? [];
    const items = raw.filter(
      (item) => item.block_unix_time >= from && item.block_unix_time <= to,
    );
    return {
      items,
      hasNext:
        (response.data?.has_next ?? response.data?.hasNext ?? raw.length === limit),
    };
  }

  async balanceChangesPage(
    wallet: string,
    mint: string,
    from: number,
    to: number,
    offset: number,
    limit = 100,
  ): Promise<OffsetPage<BirdeyeBalanceChange>> {
    const response = await this.request<{
      success?: boolean;
      data?: { items?: BirdeyeBalanceChange[]; has_next?: boolean; hasNext?: boolean };
    }>("GET", "/wallet/v2/balance-change", {
      query: {
        address: wallet,
        token_address: mint,
        type: "SPL",
        time_from: from,
        time_to: to,
        offset,
        limit,
        ui_amount_mode: "scaled",
      },
    });
    const items = response.data?.items ?? [];
    return {
      items,
      hasNext: response.data?.has_next ?? response.data?.hasNext ?? items.length === limit,
    };
  }

  async transfersPage(
    wallet: string,
    mint: string,
    cursor?: string,
    limit = 100,
  ): Promise<CursorPage<BirdeyeTransfer>> {
    // Documentation says subsequent pages should contain only `cursor`, but
    // the live API still validates `wallet` as required. Keep the identity
    // field and drop the other stale filters on cursor pages.
    const body = cursor ? { wallet, cursor } : { wallet, token_address: mint, limit };
    const response = await this.request<{
      success?: boolean;
      data?: BirdeyeTransfer[] | { items?: BirdeyeTransfer[]; next_cursor?: string };
      next_cursor?: string;
    }>("POST", "/wallet/v2/transfer", { body });
    const items = Array.isArray(response.data) ? response.data : response.data?.items ?? [];
    const nextCursor = Array.isArray(response.data)
      ? response.next_cursor
      : response.data?.next_cursor ?? response.next_cursor;
    return { items, nextCursor };
  }
}
