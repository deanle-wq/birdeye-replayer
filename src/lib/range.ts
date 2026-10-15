import { expectedCandleCount, MAX_REPLAY_CANDLES, REPLAY_TIMEFRAMES, TIMEFRAME_SECONDS, type ReplayTimeframe } from "./replay-timeframe";

/**
 * The replay window: presets for the common questions, a draggable brush for
 * everything else, and a timeframe picked so the clip has enough candles to
 * move but not so many that it strobes.
 */

export interface TimeRange {
  from: number;
  to: number;
}

export const RANGE_PRESETS = ["24h", "7d", "30d", "full", "launch", "ath"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const PRESET_LABEL: Record<RangePreset, string> = {
  full: "Full history",
  launch: "Launch day",
  "24h": "Last 24h",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  ath: "Run-up to peak",
};

/** Shortest window the brush allows: one hour. */
export const MIN_SPAN = 3_600;

/**
 * Candles a clip can show and still be read: about 14 a second (a candle
 * stays in view for 3–4 seconds), between 120 and 800.
 */
export function targetCandles(clipSeconds: number): number {
  return Math.round(Math.min(800, Math.max(120, clipSeconds * 14)));
}

export interface HistoryPoint {
  unixTime: number;
  h: number;
  l: number;
}

export function clampRange(range: TimeRange, bounds: TimeRange, minSpan = MIN_SPAN): TimeRange {
  const span = Math.max(Math.min(minSpan, bounds.to - bounds.from), Math.min(range.to - range.from, bounds.to - bounds.from));
  const from = Math.min(Math.max(bounds.from, Math.round(range.from)), bounds.to - span);
  return { from, to: from + span };
}

/** Move the window without resizing it; it stops at either end. */
export function panRange(range: TimeRange, delta: number, bounds: TimeRange): TimeRange {
  return clampRange({ from: range.from + delta, to: range.to + delta }, bounds);
}

/** Drag one edge; the other stays put and the window never inverts. */
export function moveEdge(range: TimeRange, edge: "from" | "to", value: number, bounds: TimeRange, minSpan = MIN_SPAN): TimeRange {
  if (edge === "from") {
    const from = Math.min(Math.max(bounds.from, Math.round(value)), range.to - minSpan);
    return { from: Math.max(bounds.from, from), to: range.to };
  }
  const to = Math.max(Math.min(bounds.to, Math.round(value)), range.from + minSpan);
  return { from: range.from, to: Math.min(bounds.to, to) };
}

export function presetRange(preset: RangePreset, bounds: TimeRange, history: HistoryPoint[]): TimeRange {
  const last = (seconds: number) => clampRange({ from: bounds.to - seconds, to: bounds.to }, bounds);
  switch (preset) {
    case "full":
      return { ...bounds };
    case "launch":
      return clampRange({ from: bounds.from, to: bounds.from + 86_400 }, bounds);
    case "24h":
      return last(86_400);
    case "7d":
      return last(7 * 86_400);
    case "30d":
      return last(30 * 86_400);
    case "ath": {
      // From the lowest low before the all-time high, to just past the high.
      if (history.length < 2) return { ...bounds };
      let peak = 0;
      history.forEach((point, index) => {
        if (point.h > history[peak]!.h) peak = index;
      });
      let trough = 0;
      for (let index = 0; index <= peak; index += 1) if (history[index]!.l < history[trough]!.l) trough = index;
      const step = history.length > 1 ? history[1]!.unixTime - history[0]!.unixTime : 3_600;
      return clampRange({ from: history[trough]!.unixTime, to: history[peak]!.unixTime + step * 2 }, bounds);
    }
  }
}

/** Finest timeframe that keeps the window within the target candle count. */
export function autoTimeframe(range: TimeRange, target = 800): ReplayTimeframe {
  for (const timeframe of REPLAY_TIMEFRAMES) {
    if (expectedCandleCount(range.from, range.to, timeframe) <= target) return timeframe;
  }
  return "1W";
}

export function timeframeAllowed(range: TimeRange, timeframe: ReplayTimeframe): boolean {
  const count = expectedCandleCount(range.from, range.to, timeframe);
  return count <= MAX_REPLAY_CANDLES && count >= 3;
}

/** Snap to the timeframe's grid so candles and tag buckets line up. */
export function snapRange(range: TimeRange, timeframe: ReplayTimeframe): TimeRange {
  const step = TIMEFRAME_SECONDS[timeframe];
  return { from: Math.floor(range.from / step) * step, to: Math.ceil(range.to / step) * step };
}

/** UTC <input type="datetime-local"> value. */
export function toInputValue(unix: number): string {
  return new Date(unix * 1_000).toISOString().slice(0, 16);
}

export function fromInputValue(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  const ms = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  return Number.isFinite(ms) ? Math.floor(ms / 1_000) : null;
}

export function formatSpan(seconds: number): string {
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`;
  if (seconds < 86_400 * 60) return `${Math.round(seconds / 86_400)}d`;
  return `${(seconds / (86_400 * 30.44)).toFixed(seconds < 86_400 * 365 ? 0 : 1)}mo`;
}

export function formatMoment(unix: number, withTime = true): string {
  return new Date(unix * 1_000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  });
}
