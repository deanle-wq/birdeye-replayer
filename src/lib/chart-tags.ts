import type { BirdeyeCandle } from "@/server/birdeye/types";
import { candleIndexAtOrBefore } from "./replay-timeframe";

/**
 * Tag layers a viewer can add to the chart. Each one comes from a Birdeye
 * Data endpoint and keeps Birdeye's own definition, so a marker always means
 * what the docs say it means.
 */
export type TagLayer = "big" | "smart_trader" | "kol" | "sniper" | "dev";

export const TAG_LAYERS: TagLayer[] = ["big", "smart_trader", "kol", "sniper", "dev"];

/** Wallet tags the Wallet Tags Tracker groups by. */
export const TRACKER_TAGS = ["smart_trader", "kol", "sniper", "dev"] as const;
export type TrackerTag = (typeof TRACKER_TAGS)[number];

export const LAYER_INFO: Record<TagLayer, { emoji: string; label: string; caption: string; description: string }> = {
  big: {
    emoji: "🐋",
    label: "Big trades",
    caption: "BIG",
    description: "Single swaps at or above the size you set (Trades - Token Filtered By Volume).",
  },
  smart_trader: {
    emoji: "🧠",
    label: "Smart money",
    caption: "SMART MONEY",
    description: "Non-bot wallets in Birdeye's top 90-day realized PnL, above $10K (Wallet Tags Tracker).",
  },
  kol: {
    emoji: "🎤",
    label: "KOLs",
    caption: "KOL",
    description: "Wallets Birdeye classifies as key opinion leaders (Wallet Tags Tracker).",
  },
  sniper: {
    emoji: "🎯",
    label: "Snipers",
    caption: "SNIPER",
    description: "Wallets that bought within the first 5 blocks of trading (Wallet Tags Tracker).",
  },
  dev: {
    emoji: "🛠️",
    label: "Dev",
    caption: "DEV",
    description: "The wallet that created the token (Wallet Tags Tracker).",
  },
};

export interface TagEvent {
  layer: TagLayer;
  side: "buy" | "sell";
  /** Unix seconds: the swap's block time, or the tracker bucket's open. */
  t: number;
  /** Swap value, or the bucket's net flow for this cohort (always positive; `side` carries the sign). */
  usd: number;
  /** Distinct wallets on that side of the bucket (tracker layers). */
  wallets?: number;
  /** The trading wallet (big trades). */
  wallet?: string;
  /** Birdeye identity labels of the wallets behind it, when known. */
  names?: string[];
  tx?: string;
}

export type Density = "key" | "normal" | "all";

/** Markers kept per layer, biggest first. */
export const DENSITY_LIMIT: Record<Density, number> = { key: 6, normal: 14, all: 60 };

/** Keep each enabled layer's biggest events, then put them back in time order. */
export function selectEvents(events: TagEvent[], layers: ReadonlySet<TagLayer>, density: Density): TagEvent[] {
  const limit = DENSITY_LIMIT[density];
  const kept: TagEvent[] = [];
  for (const layer of TAG_LAYERS) {
    if (!layers.has(layer)) continue;
    kept.push(...events.filter((event) => event.layer === layer).sort((a, b) => b.usd - a.usd).slice(0, limit));
  }
  return kept.sort((a, b) => a.t - b.t || b.usd - a.usd);
}

/** One tracker bucket for one cohort, as Birdeye returns it. */
export interface TrackerBucket {
  unix_time: number;
  volume_buy_usd?: number;
  volume_sell_usd?: number;
  wallet_buy_count?: number;
  wallet_sell_count?: number;
}

/**
 * A bucket becomes one marker on the side of its net flow. Volumes are
 * gross and leg-based, so a cohort that bought and sold the same amount in a
 * bucket nets to nothing and gets no marker.
 */
export function trackerEvents(layer: TrackerTag, buckets: TrackerBucket[], minUsd = 1): TagEvent[] {
  const events: TagEvent[] = [];
  for (const bucket of buckets) {
    const buy = Number(bucket.volume_buy_usd) || 0;
    const sell = Number(bucket.volume_sell_usd) || 0;
    const net = buy - sell;
    if (!Number.isFinite(net) || Math.abs(net) < minUsd) continue;
    const side = net > 0 ? "buy" : "sell";
    events.push({
      layer,
      side,
      t: bucket.unix_time,
      usd: Math.abs(net),
      wallets: Number(side === "buy" ? bucket.wallet_buy_count : bucket.wallet_sell_count) || undefined,
    });
  }
  return events;
}

/**
 * Arbitrage and MEV bots buy and sell the same size within seconds; those
 * pairs are not conviction. A buy and a sell by the same wallet, within
 * `windowSeconds` and `tolerance` of each other's size, are dropped together.
 */
export function dropRoundTrips(events: TagEvent[], windowSeconds = 120, tolerance = 0.15): { kept: TagEvent[]; dropped: number } {
  const paired = new Set<TagEvent>();
  const byWallet = new Map<string, TagEvent[]>();
  for (const event of events) {
    if (!event.wallet) continue;
    const list = byWallet.get(event.wallet) ?? [];
    list.push(event);
    byWallet.set(event.wallet, list);
  }
  for (const list of byWallet.values()) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      if (paired.has(a)) continue;
      for (let j = i + 1; j < list.length && list[j]!.t - a.t <= windowSeconds; j += 1) {
        const b = list[j]!;
        if (paired.has(b) || b.side === a.side) continue;
        if (Math.abs(a.usd - b.usd) / Math.max(a.usd, b.usd) <= tolerance) {
          paired.add(a);
          paired.add(b);
          break;
        }
      }
    }
  }
  return { kept: events.filter((event) => !paired.has(event)), dropped: paired.size };
}

export interface EventBar {
  bar: number;
  events: TagEvent[];
}

/** Events grouped by the candle they fall in; events outside the candles are counted, not drawn. */
export function binTagEvents(events: TagEvent[], candles: Pick<BirdeyeCandle, "unixTime">[], barSeconds: number) {
  const bars = new Map<number, TagEvent[]>();
  let outside = 0;
  const last = candles.at(-1);
  for (const event of events) {
    const index = candleIndexAtOrBefore(candles, event.t);
    if (index < 0 || !last || event.t >= last.unixTime + barSeconds) {
      outside += 1;
      continue;
    }
    const held = bars.get(index) ?? [];
    held.push(event);
    bars.set(index, held);
  }
  const list: EventBar[] = [...bars.entries()].map(([bar, items]) => ({ bar, events: items.sort((a, b) => b.usd - a.usd) })).sort((a, b) => a.bar - b.bar);
  return { bars: list, outside };
}

/** Totals per layer and side, for the result card. */
export function tagSummary(events: TagEvent[]) {
  const summary = new Map<TagLayer, { buys: number; sells: number; buyUsd: number; sellUsd: number }>();
  for (const event of events) {
    const held = summary.get(event.layer) ?? { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0 };
    if (event.side === "buy") {
      held.buys += 1;
      held.buyUsd += event.usd;
    } else {
      held.sells += 1;
      held.sellUsd += event.usd;
    }
    summary.set(event.layer, held);
  }
  return summary;
}
