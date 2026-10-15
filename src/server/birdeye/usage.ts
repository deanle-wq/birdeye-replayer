/**
 * Compute-unit prices from Birdeye's published table
 * (https://data.birdeye.so/docs/guides/what-is-compute-unit-cost.md, read
 * 2026-10-08). Cache hits are free and are counted separately.
 */
type CostRule = (input: { query: URLSearchParams; body: unknown; response: unknown }) => number;

const fixed = (cu: number): CostRule => () => cu;
const batch = (base: number, count: (query: URLSearchParams) => number): CostRule =>
  ({ query }) => Math.ceil(base * Math.max(1, count(query)) ** 0.8);

function ohlcvItems(response: unknown): number {
  const items = (response as { data?: { items?: unknown[] } })?.data?.items;
  return Array.isArray(items) ? items.length : 0;
}

const COSTS: Record<string, CostRule> = {
  "/defi/v3/token/meta-data/single": fixed(3),
  "/defi/price": fixed(3),
  "/defi/v3/token/market-data": fixed(10),
  "/defi/v3/token/meta-data/multiple": batch(3, (query) => (query.get("list_address") ?? "").split(",").filter(Boolean).length),
  "/wallet/v2/pnl/details": fixed(30),
  "/wallet/v2/current-net-worth": fixed(30),
  "/identity/v1/single": fixed(30),
  "/token/v1/wallet-tags-tracker": fixed(30),
  "/token/v1/wallet-tags-tracker/details": fixed(30),
  // Dynamic: 40 CU up to 100 items, 80 up to 200, 200 up to 500.
  "/defi/v3/token/txs-by-volume": ({ query }) => {
    const limit = Number(query.get("limit") ?? 100);
    return limit <= 100 ? 40 : limit <= 200 ? 80 : 200;
  },
  "/defi/v3/ohlcv": ({ response }) => {
    const items = ohlcvItems(response);
    if (items <= 100) return 25;
    if (items <= 300) return 30;
    if (items <= 1_000) return 40;
    if (items <= 2_000) return 75;
    return 100;
  },
  "/defi/v2/tokens/top_traders": fixed(30),
  "/wallet/v2/pnl/multiple": batch(30, (query) => (query.get("wallets") ?? "").split(",").filter(Boolean).length),
  "/defi/v3/token/txs": fixed(12),
  "/trader/txs/seek_by_time": fixed(12),
  "/wallet/v2/balance-change": fixed(10),
  "/wallet/v2/transfer": fixed(10),
};

export interface EndpointUsage {
  path: string;
  requests: number;
  cu: number;
}

export interface ApiUsage {
  /** Billable responses from Birdeye. */
  requests: number;
  /** Responses served from this server's cache: no CU spent. */
  cacheHits: number;
  cu: number;
  endpoints: EndpointUsage[];
}

export class UsageMeter {
  private readonly endpoints = new Map<string, EndpointUsage>();
  private cacheHits = 0;

  record(path: string, query: URLSearchParams, body: unknown, response: unknown): void {
    const rule = COSTS[path];
    const cu = rule ? rule({ query, body, response }) : 0;
    const held = this.endpoints.get(path) ?? { path, requests: 0, cu: 0 };
    held.requests += 1;
    held.cu += cu;
    this.endpoints.set(path, held);
  }

  hit(): void {
    this.cacheHits += 1;
  }

  snapshot(): ApiUsage {
    const endpoints = [...this.endpoints.values()].sort((a, b) => b.cu - a.cu);
    return {
      requests: endpoints.reduce((sum, item) => sum + item.requests, 0),
      cacheHits: this.cacheHits,
      cu: endpoints.reduce((sum, item) => sum + item.cu, 0),
      endpoints,
    };
  }
}
