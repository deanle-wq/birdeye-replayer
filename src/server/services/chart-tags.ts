import { dropRoundTrips, TRACKER_TAGS, trackerEvents, type TagEvent, type TagLayer, type TrackerBucket, type TrackerTag } from "@/lib/chart-tags";
import { TIMEFRAME_SECONDS, type ReplayTimeframe } from "@/lib/replay-timeframe";
import { BirdeyeClient, BirdeyeError } from "../birdeye/client";
import type { ApiUsage } from "../birdeye/usage";
import { cached } from "./cache";

/**
 * Tag layers for one replay window. Wallet Tags Tracker buckets become
 * markers on the side of their net flow; Trades Filtered By Volume swaps
 * become big-trade markers; Wallet Identity names the KOLs and the biggest
 * traders when asked.
 */

/** Wallet Tags Tracker bucket sizes, with Birdeye's maximum range per request. */
export const TRACKER_FRAMES = [
  { frame: "1m", seconds: 60, maxRange: 60 * 86_400 },
  { frame: "3m", seconds: 180, maxRange: 60 * 86_400 },
  { frame: "5m", seconds: 300, maxRange: 60 * 86_400 },
  { frame: "15m", seconds: 900, maxRange: 60 * 86_400 },
  { frame: "30m", seconds: 1_800, maxRange: 60 * 86_400 },
  { frame: "1h", seconds: 3_600, maxRange: 90 * 86_400 },
  { frame: "2h", seconds: 7_200, maxRange: 90 * 86_400 },
  { frame: "4h", seconds: 14_400, maxRange: 90 * 86_400 },
  { frame: "1D", seconds: 86_400, maxRange: 365 * 86_400 },
  { frame: "1W", seconds: 604_800, maxRange: 365 * 86_400 },
] as const;

/** At most this many buckets per window: a marker per bucket is plenty. */
const MAX_BUCKETS = 300;
/** Pages of tracker data per window (30 CU each). */
const MAX_TRACKER_PAGES = 16;

/** The finest bucket at least as wide as a candle that keeps the window under MAX_BUCKETS. */
export function trackerFrame(from: number, to: number, timeframe: ReplayTimeframe) {
  const candle = TIMEFRAME_SECONDS[timeframe];
  const span = Math.max(1, to - from);
  return TRACKER_FRAMES.find((entry) => entry.seconds >= candle && span / entry.seconds <= MAX_BUCKETS)
    ?? TRACKER_FRAMES.at(-1)!;
}

/**
 * Split a window into Birdeye's maximum range per request for the frame,
 * two buckets short of it: Birdeye aligns buckets to their own grid, so a
 * window of exactly the maximum can still be rejected.
 */
export function trackerWindows(from: number, to: number, maxRange: number, bucketSeconds = 0): Array<{ from: number; to: number }> {
  const step = Math.max(bucketSeconds, maxRange - bucketSeconds * 2);
  const windows: Array<{ from: number; to: number }> = [];
  for (let start = from; start < to; start += step) windows.push({ from: start, to: Math.min(to, start + step) });
  return windows.length > 0 ? windows : [{ from, to }];
}

/** A round USD threshold near `value`: 500, 1K, 2.5K, 5K, 10K… */
export function niceThreshold(value: number): number {
  const clamped = Math.min(1_000_000, Math.max(250, value));
  const magnitude = 10 ** Math.floor(Math.log10(clamped));
  return [1, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= clamped) ?? clamped;
}

export interface TagRequest {
  mint: string;
  from: number;
  to: number;
  timeframe: ReplayTimeframe;
  layers: TagLayer[];
  /** Big-trade size in USD; omit for automatic. */
  minUsd?: number;
  /** USD volume of the window, used to pick the automatic big-trade size. */
  volumeUsd?: number;
  /** Look up Birdeye identity labels for KOLs and the biggest traders. */
  names?: boolean;
}

export interface TagResult {
  events: TagEvent[];
  /** Plain-language notes for the editor: unsupported token, plan limits, truncation. */
  notes: string[];
  trackerFrame?: string;
  bigThresholdUsd?: number;
  usage: ApiUsage;
}

interface TrackerResponse {
  data?: {
    groups?: { tags?: Partial<Record<TrackerTag, TrackerBucket[]>> };
    has_more?: boolean;
    next_time_from?: number;
  };
}

interface DetailsResponse {
  data?: {
    items?: Array<{ unix_time: number; wallets?: Array<{ wallet: string; volume_buy_usd?: number; volume_sell_usd?: number; tags?: string[] }> }>;
    has_more?: boolean;
    next_time_from?: number;
  };
}

interface TradesResponse {
  data?: {
    items?: Array<{ side?: string; tx_type?: string; tx_hash?: string; block_unix_time?: number; volume_usd?: number; owner?: string }>;
    has_next?: boolean;
  };
}

interface IdentityResponse {
  data?: { label?: string; entity?: string };
}

function unsupported(error: unknown): boolean {
  return error instanceof BirdeyeError && error.status === 400 && /not supported/i.test(error.message);
}

function planBlocked(error: unknown): boolean {
  return error instanceof BirdeyeError && (error.status === 401 || error.status === 403);
}

async function trackerLayer(client: BirdeyeClient, request: TagRequest, tags: TrackerTag[], notes: string[]) {
  const { frame, maxRange, seconds } = trackerFrame(request.from, request.to, request.timeframe);
  const buckets = new Map<TrackerTag, TrackerBucket[]>();
  let pages = 0;
  let truncated = false;
  for (const window of trackerWindows(request.from, request.to, maxRange, seconds)) {
    let cursor = window.from;
    while (cursor < window.to) {
      if (pages >= MAX_TRACKER_PAGES) {
        truncated = true;
        break;
      }
      pages += 1;
      const response = (await client.walletTagsTracker(request.mint, cursor, window.to, frame, tags)) as TrackerResponse;
      for (const tag of tags) {
        const series = response.data?.groups?.tags?.[tag] ?? [];
        buckets.set(tag, [...(buckets.get(tag) ?? []), ...series]);
      }
      const next = Number(response.data?.next_time_from);
      if (!response.data?.has_more || !Number.isFinite(next) || next <= cursor) break;
      cursor = next;
    }
  }
  if (truncated) notes.push(`Wallet tags cover the first ${pages * 50} ${frame} buckets of this window; narrow it for the rest.`);
  const events: TagEvent[] = [];
  for (const tag of tags) {
    const series = (buckets.get(tag) ?? []).filter((bucket) => bucket.unix_time >= request.from - seconds && bucket.unix_time <= request.to);
    events.push(...trackerEvents(tag, series));
  }
  return { events, frame };
}

async function bigTradeLayer(client: BirdeyeClient, request: TagRequest, notes: string[]) {
  const automatic = !(request.minUsd && request.minUsd > 0);
  // Start near 1/400th of the window's volume (or the size asked for) and
  // raise it until the window has at most 200 such swaps.
  let threshold = automatic ? niceThreshold((request.volumeUsd ?? 400_000) / 400) : request.minUsd!;
  // `used` is the size the kept page was fetched at; `threshold` is the next try.
  let used = threshold;
  let items: NonNullable<TradesResponse["data"]>["items"] = [];
  let full = false;
  let raised = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    used = threshold;
    const response = (await client.tradesByVolume(request.mint, request.from, request.to, used, 200)) as TradesResponse;
    items = response.data?.items ?? [];
    full = Boolean(response.data?.has_next);
    if (full) {
      // Too many: raise the size until the window fits one page.
      raised = true;
      threshold = niceThreshold(used * 2.5);
      continue;
    }
    // Automatic size found almost nothing: lower it, unless a raise just overshot.
    if (automatic && !raised && items.length < 8 && used > 250) {
      threshold = niceThreshold(used / 5);
      continue;
    }
    break;
  }
  if (full) notes.push(`More than 200 swaps above $${Math.round(used).toLocaleString("en-US")}; the first 200 are shown. Raise the size to see the biggest only.`);
  else if (!automatic && used > request.minUsd!) notes.push(`Big-trade size raised to $${used.toLocaleString("en-US")} so the window fits 200 swaps.`);
  const events: TagEvent[] = [];
  for (const item of items ?? []) {
    const side = item.side === "buy" || item.side === "sell" ? item.side : item.tx_type === "buy" || item.tx_type === "sell" ? item.tx_type : null;
    const usd = Number(item.volume_usd);
    const t = Number(item.block_unix_time);
    if (!side || !Number.isFinite(usd) || usd <= 0 || !Number.isFinite(t)) continue;
    events.push({ layer: "big", side, t, usd, wallet: item.owner, tx: item.tx_hash });
  }
  const { kept, dropped } = dropRoundTrips(events);
  if (dropped > 0) notes.push(`Hid ${dropped} big swaps that were round trips: the same wallet bought and sold the same size within two minutes, as arbitrage bots do.`);
  return { events: kept, threshold: used };
}

/** Name the KOLs behind each KOL bucket, and the wallets behind the biggest swaps. */
async function attachNames(client: BirdeyeClient, request: TagRequest, frame: string | undefined, events: TagEvent[], notes: string[]) {
  const kolWallets = new Map<number, Array<{ wallet: string; buy: number; sell: number }>>();
  const spec = TRACKER_FRAMES.find((entry) => entry.frame === frame);
  if (spec && events.some((event) => event.layer === "kol")) {
    let pages = 0;
    for (const window of trackerWindows(request.from, request.to, spec.maxRange, spec.seconds)) {
      let cursor = window.from;
      while (cursor < window.to && pages < 6) {
        pages += 1;
        const response = (await client.walletTagsDetails(request.mint, cursor, window.to, spec.frame, ["kol"], 3, 300)) as DetailsResponse;
        for (const bucket of response.data?.items ?? []) {
          kolWallets.set(bucket.unix_time, (bucket.wallets ?? []).map((row) => ({ wallet: row.wallet, buy: Number(row.volume_buy_usd) || 0, sell: Number(row.volume_sell_usd) || 0 })));
        }
        const next = Number(response.data?.next_time_from);
        if (!response.data?.has_more || !Number.isFinite(next) || next <= cursor) break;
        cursor = next;
      }
    }
  }
  const volume = new Map<string, number>();
  for (const rows of kolWallets.values()) for (const row of rows) volume.set(row.wallet, (volume.get(row.wallet) ?? 0) + row.buy + row.sell);
  const bigOwners = events.filter((event) => event.layer === "big" && event.wallet).sort((a, b) => b.usd - a.usd).slice(0, 5);
  const lookups = [...[...volume.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([wallet]) => wallet), ...bigOwners.map((event) => event.wallet!)]
    .filter((wallet, index, list) => list.indexOf(wallet) === index)
    .slice(0, 10);
  const labels = new Map<string, string>();
  let blocked = false;
  await Promise.all(lookups.map(async (wallet) => {
    try {
      const response = (await client.walletIdentity(wallet)) as IdentityResponse;
      const label = response.data?.label ?? response.data?.entity;
      if (label) labels.set(wallet, label.replace(/^KOL:\s*/i, ""));
    } catch (error) {
      if (planBlocked(error)) blocked = true;
    }
  }));
  if (blocked) notes.push("Wallet names need an API plan with Wallet Identity; markers show without names.");
  for (const event of events) {
    if (event.layer === "kol") {
      const names = (kolWallets.get(event.t) ?? [])
        .filter((row) => (event.side === "buy" ? row.buy > row.sell : row.sell > row.buy))
        .map((row) => labels.get(row.wallet))
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) event.names = [...new Set(names)].slice(0, 2);
    } else if (event.layer === "big" && event.wallet && labels.has(event.wallet)) {
      event.names = [labels.get(event.wallet)!];
    }
  }
}

async function chartTagsUncached(request: TagRequest, apiKey: string): Promise<TagResult> {
  const client = new BirdeyeClient(apiKey);
  const notes: string[] = [];
  const tags = TRACKER_TAGS.filter((tag) => request.layers.includes(tag));
  const [tracker, big] = await Promise.all([
    tags.length > 0
      ? trackerLayer(client, request, tags, notes).catch((error) => {
        if (unsupported(error)) notes.push("Birdeye does not track wallet tags for this token (core and very large tokens such as SOL, USDC and BONK are excluded).");
        else if (planBlocked(error)) notes.push("Your API plan does not include the Wallet Tags Tracker.");
        else throw error;
        return null;
      })
      : Promise.resolve(null),
    request.layers.includes("big")
      ? bigTradeLayer(client, request, notes).catch((error) => {
        if (planBlocked(error)) notes.push("Your API plan does not include Trades Filtered By Volume.");
        else throw error;
        return null;
      })
      : Promise.resolve(null),
  ]);
  const events = [...(tracker?.events ?? []), ...(big?.events ?? [])].sort((a, b) => a.t - b.t);
  if (request.names && events.length > 0) await attachNames(client, request, tracker?.frame, events, notes);
  return { events, notes, trackerFrame: tracker?.frame, bigThresholdUsd: big?.threshold, usage: client.usage() };
}

export function chartTags(request: TagRequest, apiKey = process.env.BIRDEYE_API_KEY ?? ""): Promise<TagResult> {
  const key = ["tags", request.mint, request.from, request.to, request.timeframe, [...request.layers].sort().join(","), request.minUsd ?? "auto", Math.round(request.volumeUsd ?? 0), request.names ? 1 : 0].join(":");
  return cached(apiKey, key, () => chartTagsUncached(request, apiKey));
}
