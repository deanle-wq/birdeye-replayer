import type { EventBar, TagEvent } from "./chart-tags";

/**
 * Pure timing for a chart clip. Everything is a function of clip time
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

export interface TagBurst {
  start: number;
  end: number;
  bars: Array<{ bar: number; time: number; events: TagEvent[] }>;
}

/**
 * Tag events that land within `minGap` seconds share one popup, so a busy
 * stretch reads as one callout instead of a strobe. Cut at `maxSpan`.
 */
export function tagBursts(bars: EventBar[], candleCount: number, replaySeconds: number, minGap = 0.45, maxSpan = 1.6): TagBurst[] {
  const bursts: TagBurst[] = [];
  for (const entry of bars) {
    const time = barTime(entry.bar, candleCount, replaySeconds);
    const held = bursts.at(-1);
    if (held && time - held.end < minGap && time - held.start <= maxSpan) {
      held.bars.push({ bar: entry.bar, time, events: entry.events });
      held.end = time;
    } else {
      bursts.push({ start: time, end: time, bars: [{ bar: entry.bar, time, events: entry.events }] });
    }
  }
  return bursts;
}

/** The burst's events revealed by clip time `t`, biggest first. */
export function burstEventsAt(burst: TagBurst, t: number): TagEvent[] {
  const events: TagEvent[] = [];
  for (const bar of burst.bars) {
    if (bar.time > t + 1e-9) break;
    events.push(...bar.events);
  }
  return events.sort((a, b) => b.usd - a.usd);
}

export interface BurstLabel {
  burst: TagBurst;
  enter: number;
  exit: number;
}

export const LABEL_ENTER_SECONDS = 0.62;
export const LABEL_EXIT_SECONDS = 0.16;

/** Popups at clip time `t`: the newest burst, plus the previous one while it leaves. */
export function activeLabels(bursts: TagBurst[], t: number, holdSeconds: number): BurstLabel[] {
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
    const previous = bursts[i - 1];
    const displaced = previous && previous.end + holdSeconds > burst.start;
    const enterAt = burst.start + (displaced ? LABEL_EXIT_SECONDS * 0.75 : 0);
    const enter = Math.min(1, Math.max(0, (t - enterAt) / LABEL_ENTER_SECONDS));
    if (enter <= 0 && exit === 0 && displaced) continue;
    labels.push({ burst, enter, exit });
  }
  return labels;
}

/** Marker bars accumulate after they are revealed and leave only with the visible chart window. */
export function visibleTagBars<T>(bars: Map<number, T>, first: number, settled: number): Array<[number, T]> {
  return [...bars.entries()].filter(([bar]) => bar + 1 <= settled && bar + 1 >= Math.ceil(first));
}

export type SoundCue = "buy" | "sell" | "milestone" | "bandos" | "tick" | "win" | "loss";
export type SoundPack = "glass" | "clean" | "meme";

export interface TimedCue {
  t: number;
  cue: SoundCue;
  step?: number;
}

/**
 * One cue per burst side, a call each time the price clears another step
 * above where the clip started (about four a clip), and a counted outro.
 */
export function cueSchedule(input: {
  bursts: TagBurst[];
  /** Price change from the first close, sampled at clip times, ascending. */
  change: Array<{ t: number; pct: number }>;
  timeline: VideoTimeline;
  finalPct: number;
  pack?: SoundPack;
}): TimedCue[] {
  if (input.pack === "glass") {
    // Keep the largest trades, with enough air for each 1.2s sweep to settle.
    const selected: Array<TimedCue & { usd: number }> = [];
    const candidates = input.bursts.flatMap(burst => burst.bars.flatMap(bar =>
      bar.events.map(event => ({ t: Math.max(.05, bar.time), cue: event.side, usd: event.usd })),
    )).sort((a, b) => b.usd - a.usd);
    for (const candidate of candidates) {
      if (candidate.t > input.timeline.replaySeconds - 1.4) continue;
      if (selected.every(cue => Math.abs(cue.t - candidate.t) >= 1.5)) selected.push(candidate);
    }
    return [
      ...selected.map(({ t, cue }) => ({ t, cue })),
      { t: input.timeline.replaySeconds + .12, cue: input.finalPct >= 0 ? "win" as const : "loss" as const },
    ].sort((a, b) => a.t - b.t);
  }
  const cues: TimedCue[] = [];
  for (const burst of input.bursts) {
    const firstBuy = burst.bars.find((bar) => bar.events.some((event) => event.side === "buy"));
    const firstSell = burst.bars.find((bar) => bar.events.some((event) => event.side === "sell"));
    if (firstBuy) cues.push({ t: firstBuy.time, cue: "buy" });
    if (firstSell) cues.push({ t: firstSell.time + (firstBuy?.time === firstSell.time ? 0.08 : 0), cue: "sell" });
  }
  const peak = input.change.reduce((max, point) => Math.max(max, point.pct), 0);
  if (peak > 0.04) {
    const step = milestoneStep(peak);
    let tier = 0;
    let count = 0;
    for (const point of input.change) {
      const reached = Math.floor(point.pct / step);
      if (reached > tier) {
        tier = reached;
        cues.push({ t: point.t, cue: input.pack === "meme" ? "bandos" : "milestone", step: count });
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
  cues.push({ t: countTo, cue: input.finalPct >= 0 ? "win" : "loss" });
  return cues.sort((a, b) => a.t - b.t);
}

/** Round step at or under a quarter of the peak gain (as a fraction): 0.05, 0.1, 0.25, 0.5, 1, 2.5… */
export function milestoneStep(peak: number): number {
  const raw = Math.max(peak / 4, 0.01);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [5, 2.5, 2, 1].map((multiple) => multiple * magnitude).find((step) => step <= raw) ?? magnitude;
}

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

export function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 2 : Math.abs(value) < 10 ? 2 : 0,
  }).format(value || 0);
}

/** `+123%`, `−42.5%`, `+12.3x` past +1,000%. */
export function formatChange(fraction: number): string {
  if (!Number.isFinite(fraction)) return "N/A";
  const sign = fraction < 0 ? "−" : "+";
  const pct = Math.abs(fraction * 100);
  if (fraction >= 10) return `+${(fraction + 1).toFixed(fraction >= 99 ? 0 : 1)}x`;
  return `${sign}${pct.toLocaleString("en-US", { maximumFractionDigits: pct >= 100 ? 0 : 1 })}%`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
