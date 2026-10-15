import type { LedgerEvent } from "@/server/pnl/ledger";
import type { EventBins } from "./replay-window";

/**
 * Pure timing for a wallet clip. Everything here is a function of clip time
 * (seconds), so the live preview and the frame-by-frame export cannot drift.
 */

export interface VideoTimeline {
  clipSeconds: number;
  /** Candles play out over this span… */
  replaySeconds: number;
  /** …then the result card owns the rest. */
  outroSeconds: number;
}

export function videoTimeline(clipSeconds: number): VideoTimeline {
  const outroSeconds = Math.min(clipSeconds * 0.45, Math.max(2.5, Math.min(4, clipSeconds * 0.22)));
  return { clipSeconds, replaySeconds: clipSeconds - outroSeconds, outroSeconds };
}

/** Clip time at which a bar finishes forming. */
export function barTime(bar: number, candleCount: number, replaySeconds: number): number {
  return (bar / Math.max(candleCount - 1, 1)) * replaySeconds;
}

export interface FillBurst {
  /** Clip seconds of the first bar in the burst. */
  start: number;
  /** Clip seconds of the last bar in the burst. */
  end: number;
  bars: Array<{ bar: number; time: number; buy: LedgerEvent[]; sell: LedgerEvent[] }>;
}

/**
 * Fills that land within `minGap` seconds of each other share one popup, so
 * a wallet trading every bar reads as one rising number instead of a strobe.
 * A burst is cut at `maxSpan` so a long session still gets fresh callouts.
 */
export function fillBursts(
  bins: EventBins,
  candleCount: number,
  replaySeconds: number,
  minGap = 0.45,
  maxSpan = 1.6,
): FillBurst[] {
  const bars = [...bins.fills.entries()]
    .map(([bar, fills]) => ({ bar, time: barTime(bar, candleCount, replaySeconds), ...fills }))
    .sort((a, b) => a.bar - b.bar);
  const bursts: FillBurst[] = [];
  for (const entry of bars) {
    const held = bursts.at(-1);
    if (held && entry.time - held.end < minGap && entry.time - held.start <= maxSpan) {
      held.bars.push(entry);
      held.end = entry.time;
    } else {
      bursts.push({ start: entry.time, end: entry.time, bars: [entry] });
    }
  }
  return bursts;
}

export interface BurstLabel {
  burst: FillBurst;
  /** 0→1 over the entrance. */
  enter: number;
  /** 0 while shown, 0→1 while leaving. */
  exit: number;
}

export const LABEL_ENTER_SECONDS = 0.62;
export const LABEL_EXIT_SECONDS = 0.16;

/**
 * Popups on screen at clip time `t`: the newest burst, plus the previous one
 * while it is pushed out. Never more than two, so the frame stays readable.
 */
export function activeLabels(bursts: FillBurst[], t: number, holdSeconds: number): BurstLabel[] {
  let index = -1;
  for (let i = 0; i < bursts.length && bursts[i]!.start <= t; i += 1) index = i;
  const labels: BurstLabel[] = [];
  for (const i of [index - 1, index]) {
    const burst = bursts[i];
    if (!burst) continue;
    const next = bursts[i + 1];
    const leaveAt = Math.min(burst.end + holdSeconds, next && next.start <= t ? next.start : Infinity);
    const exit = t <= leaveAt ? 0 : (t - leaveAt) / LABEL_EXIT_SECONDS;
    if (exit >= 1) continue;
    // When this burst pushed a popup out, enter only once that one has
    // mostly cleared: the swap reads as one card leaving, then the next.
    const previous = bursts[i - 1];
    const displaced = previous && previous.end + holdSeconds > burst.start;
    const enterAt = burst.start + (displaced ? LABEL_EXIT_SECONDS * 0.75 : 0);
    const enter = Math.min(1, Math.max(0, (t - enterAt) / LABEL_ENTER_SECONDS));
    if (enter <= 0 && exit === 0 && displaced) continue;
    labels.push({ burst, enter, exit });
  }
  return labels;
}

/** Sums of the burst's fills revealed by clip time `t`, by side. */
export function burstValueAt(burst: FillBurst, t: number, value: (event: LedgerEvent) => number) {
  let buy = 0;
  let sell = 0;
  let buys = 0;
  let sells = 0;
  for (const bar of burst.bars) {
    if (bar.time > t + 1e-9) break;
    for (const event of bar.buy) buy += value(event);
    for (const event of bar.sell) sell += value(event);
    buys += bar.buy.length;
    sells += bar.sell.length;
  }
  return { buy, sell, buys, sells };
}

export type SoundCue = "buy" | "sell" | "milestone" | "bandos" | "tick" | "win" | "loss";

export type SoundPack = "glass" | "clean" | "meme";

/** Meme pack: one "bandos" call per $20K of PnL, the joke's own unit. */
export const BANDOS_USD = 20_000;
const MAX_BANDOS = 6;

/** Whole multiples of $20K, widened so a big winner gets at most six calls. Null below $20K. */
export function bandosStep(peakUsd: number): number | null {
  if (peakUsd < BANDOS_USD) return null;
  return BANDOS_USD * Math.max(1, Math.ceil(Math.floor(peakUsd / BANDOS_USD) / MAX_BANDOS));
}

export interface TimedCue {
  t: number;
  cue: SoundCue;
  /** 0-based position for cues that climb in pitch (ticks, milestones). */
  step?: number;
}

/** The largest round step at or under a quarter of the peak: about four fanfares a clip. */
export function milestoneStep(peakUsd: number): number {
  const raw = Math.max(Math.abs(peakUsd) / 4, 100);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [5, 2.5, 2, 1].map((multiple) => multiple * magnitude).find((step) => step <= raw) ?? magnitude;
}

/**
 * One trade cue per burst side (never a machine gun on dense fills), a
 * fanfare each time PnL sets a new high-water step, and a counted outro
 * ending on a win or loss sting.
 */
export function cueSchedule(input: {
  bursts: FillBurst[];
  /** Total PnL sampled at clip times, ascending. */
  pnl: Array<{ t: number; totalUsd: number }>;
  timeline: VideoTimeline;
  finalTotalUsd: number;
  pack?: SoundPack;
}): TimedCue[] {
  const cues: TimedCue[] = [];
  for (const burst of input.bursts) {
    const firstSell = burst.bars.find((bar) => bar.sell.length > 0);
    const firstBuy = burst.bars.find((bar) => bar.buy.length > 0);
    if (firstBuy) cues.push({ t: firstBuy.time, cue: "buy" });
    if (firstSell) cues.push({ t: firstSell.time + (firstBuy?.time === firstSell.time ? 0.08 : 0), cue: "sell" });
  }

  const peak = input.pnl.reduce((max, point) => Math.max(max, point.totalUsd), 0);
  if (peak > 0) {
    // The meme pack calls "bandos" every $20K (wider for big winners); a
    // smaller winner still hears it at round steps of about a quarter of the
    // peak. The clean pack plays the synth fanfare at those round steps.
    const meme = input.pack === "meme";
    const step = (meme ? bandosStep(peak) : null) ?? milestoneStep(peak);
    let tier = Math.max(0, Math.floor((input.pnl[0]?.totalUsd ?? 0) / step));
    let count = 0;
    for (const point of input.pnl.slice(1)) {
      const reached = Math.floor(point.totalUsd / step);
      if (reached > tier) {
        tier = reached;
        cues.push({ t: point.t, cue: meme ? "bandos" : "milestone", step: count });
        count += 1;
      }
    }
  }

  const { replaySeconds, outroSeconds } = input.timeline;
  const countFrom = replaySeconds + outroSeconds * OUTRO.countStart;
  const countTo = replaySeconds + outroSeconds * OUTRO.countEnd;
  const ticks = Math.max(4, Math.min(18, Math.round((countTo - countFrom) / 0.07)));
  for (let index = 0; index < ticks; index += 1) {
    cues.push({ t: countFrom + ((countTo - countFrom) * index) / ticks, cue: "tick", step: index });
  }
  cues.push({ t: countTo, cue: input.finalTotalUsd >= 0 ? "win" : "loss" });
  return cues.sort((a, b) => a.t - b.t);
}

/** Outro choreography as fractions of the outro span. */
export const OUTRO = {
  veil: 0.22,
  appearStart: 0.06,
  appearSpan: 0.24,
  countStart: 0.1,
  countEnd: 0.52,
  slamSpan: 0.12,
};

export const easeOutCubic = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
export const easeOutExpo = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v >= 1 ? 1 : 1 - 2 ** (-10 * v);
};
export const smoothstep = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
};

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** `$0.0₄1234` for sub-cent memecoin prices, compact dollars above $1. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: value >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  }
  let zeros = Math.max(0, -Math.floor(Math.log10(value)) - 1);
  let digits = Math.round(value * 10 ** (zeros + 4));
  if (digits >= 10_000) {
    zeros -= 1;
    digits = Math.round(digits / 10);
  }
  if (zeros < 3) return `$${value.toPrecision(4).replace(/0+$/, "")}`;
  const count = String(zeros).split("").map((digit) => SUBSCRIPT[Number(digit)]).join("");
  return `$0.0${count}${String(digits).replace(/0+$/, "")}`;
}

/** Signed compact dollars: `+$1.24M`, `−$830`. */
export function signedUsd(value: number): string {
  const body = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 2 : Math.abs(value) < 10 ? 2 : 0,
  }).format(Math.abs(value || 0));
  return `${value < 0 ? "−" : "+"}${body}`;
}

export function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 2 : Math.abs(value) < 10 ? 2 : 0,
  }).format(value || 0);
}

export function compactAmount(value: number, unit: string): string {
  return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value || 0)} ${unit}`;
}
