import { TAG_LAYERS, type TagEvent, type TagLayer } from "@/lib/chart-tags";
import { TIMEFRAME_SECONDS, type ReplayTimeframe } from "@/lib/replay-timeframe";
import type { BirdeyeCandle } from "./birdeye/types";
import { historyTimeframe, type TokenChart } from "./services/token-chart";
import type { TagResult } from "./services/chart-tags";

/**
 * Sample dataset: a synthetic 90-day memecoin chart and tag stream, so the
 * app works without a key. Candles come from one continuous price function,
 * so every timeframe and every brush window agrees with every other.
 * Always labelled "Sample data" in the UI.
 */

export const DEMO_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const SUPPLY = 998_840_000;
const DAY = 86_400;

function anchor(): number {
  // Pinned to the hour so repeated requests agree.
  return Math.floor(Date.now() / 1_000 / 3_600) * 3_600;
}

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}

/** Smooth value noise in [-1, 1]: hashed lattice points, eased between. */
function valueNoise(x: number, salt: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const ease = f * f * (3 - 2 * f);
  const a = noise(i * 7.13 + salt) * 2 - 1;
  const b = noise((i + 1) * 7.13 + salt) * 2 - 1;
  return a + (b - a) * ease;
}

/** Price at unix time `t`: a launch, two pumps, a slow bleed and fractal chop. */
function priceAt(t: number, launch: number): number {
  const days = Math.max(0, (t - launch) / DAY);
  const launchRamp = 1 - Math.exp(-days * 3);
  const pump = (center: number, width: number, height: number) => height * Math.exp(-(((days - center) / width) ** 2));
  // Four octaves, from multi-day swings down to 15-minute wiggles.
  const chop = 0.22 * valueNoise(days / 3, 1) + 0.1 * valueNoise(days * 2, 2) + 0.045 * valueNoise(days * 12, 3) + 0.02 * valueNoise(days * 96, 4);
  const log = -2.4 + 1.9 * launchRamp + pump(21, 4, 1.15) + pump(58, 6, 0.85) - 0.006 * days + chop;
  return 0.42 * Math.exp(log);
}

export function demoCandles(from: number, to: number, timeframe: ReplayTimeframe): BirdeyeCandle[] {
  const launch = anchor() - 90 * DAY;
  const step = TIMEFRAME_SECONDS[timeframe];
  const start = Math.max(launch, Math.floor(from / step) * step);
  const candles: BirdeyeCandle[] = [];
  for (let open = start; open <= Math.min(to, anchor()); open += step) {
    const samples = Array.from({ length: 6 }, (_, index) => priceAt(open + (step * index) / 5, launch));
    const o = samples[0]!;
    const c = samples.at(-1)!;
    const wick = 1 + 0.004 + 0.01 * noise(open / step);
    const volumeUsd = 40_000 * (step / 3_600) * (0.4 + noise(open / 7_200)) * (1 + 6 * Math.abs(Math.log(c / o)) * 10);
    candles.push({ unixTime: open, o, c, h: Math.max(...samples) * wick, l: Math.min(...samples) / wick, v: volumeUsd / c, v_usd: volumeUsd, type: timeframe });
  }
  return candles;
}

export function demoChart(): TokenChart {
  const now = anchor();
  const from = now - 90 * DAY;
  const timeframe = historyTimeframe(from, now);
  const history = demoCandles(from, now, timeframe);
  const spot = history.at(-1)?.c ?? 0;
  return {
    demo: true,
    token: { mint: DEMO_MINT, name: "dogwifhat — demo dataset", symbol: "WIF", decimals: 6 },
    spotPriceUsd: spot,
    market: { circulatingSupply: SUPPLY, marketCapUsd: spot * SUPPLY, holders: 210_000 },
    bounds: { from, to: now },
    history,
    historyTimeframe: timeframe,
    generatedAt: now,
  };
}

const DEMO_KOLS = ["demo_kol_ansel", "demo_kol_mira", "demo_kol_tao"];

export function demoTags(from: number, to: number, timeframe: ReplayTimeframe, layers: TagLayer[], minUsd?: number): TagResult {
  const candles = demoCandles(from, to, timeframe);
  const wanted = new Set(layers.filter((layer) => TAG_LAYERS.includes(layer)));
  const events: TagEvent[] = [];
  // Automatic size: about the top tenth of candle volume, rounded.
  const volumes = candles.map((candle) => candle.v_usd ?? 0).sort((a, b) => a - b);
  const typical = volumes[Math.floor(volumes.length * 0.9)] ?? 10_000;
  const threshold = minUsd && minUsd > 0 ? minUsd : Math.max(500, Number((typical * 0.25).toPrecision(1)));
  candles.forEach((candle, index) => {
    const move = Math.log(candle.c / candle.o);
    const ahead = candles[Math.min(candles.length - 1, index + 6)]!.c / candle.c - 1;
    const seed = noise(candle.unixTime / 600);
    // Big swaps ride the biggest candles.
    const size = (candle.v_usd ?? 0) * (0.15 + seed * 0.3);
    if (wanted.has("big") && size >= threshold && seed > 0.55) {
      events.push({ layer: "big", side: move >= 0 ? "buy" : "sell", t: candle.unixTime + 60, usd: size, wallet: "5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij" });
    }
    // Smart money leans in before moves up and out before moves down.
    if (wanted.has("smart_trader") && Math.abs(ahead) > 0.06 && seed > 0.35) {
      events.push({ layer: "smart_trader", side: ahead > 0 ? "buy" : "sell", t: candle.unixTime, usd: 4_000 + Math.abs(ahead) * 60_000 * seed, wallets: 2 + Math.round(seed * 9) });
    }
    if (wanted.has("kol") && seed > 0.93) {
      events.push({ layer: "kol", side: move >= 0 ? "buy" : "sell", t: candle.unixTime, usd: 1_500 + seed * 9_000, wallets: 1, names: [DEMO_KOLS[index % DEMO_KOLS.length]!] });
    }
    if (wanted.has("sniper") && seed < 0.05 && move < 0) {
      events.push({ layer: "sniper", side: "sell", t: candle.unixTime, usd: 2_000 + seed * 40_000, wallets: 1 + Math.round(seed * 40) });
    }
    if (wanted.has("dev") && seed > 0.985) {
      events.push({ layer: "dev", side: "sell", t: candle.unixTime, usd: 3_000 + seed * 12_000, wallets: 1 });
    }
  });
  return {
    events,
    notes: ["Sample data: synthetic tags on a synthetic chart."],
    trackerFrame: timeframe,
    bigThresholdUsd: wanted.has("big") ? threshold : undefined,
    usage: { requests: 0, cacheHits: 0, cu: 0, endpoints: [] },
  };
}
