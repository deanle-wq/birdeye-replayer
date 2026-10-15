import type { BirdeyeCandle } from '@/server/birdeye/types';

/** Price, forming candle and scale share the same observed replay moment. */
export function walletPriceReplay(candles: BirdeyeCandle[], progress: number, maxVisible = 64) {
  if (candles.length < 2) throw new Error('A price replay needs at least two candles');
  const exact = Math.max(0, Math.min(1, progress)) * (candles.length - 1);
  const settled = Math.floor(exact);
  const next = Math.min(candles.length - 1, settled + 1);
  const deltas = candles.slice(1).map((candle, index) => candle.c - candles[index]!.c);
  // Monotone cubic tangents: continuous motion without inventing price extrema.
  const slopes = candles.map((_, index) => {
    if (index === 0) return deltas[0]!;
    if (index === candles.length - 1) return deltas.at(-1)!;
    const left = deltas[index - 1]!;
    const right = deltas[index]!;
    return left * right <= 0 ? 0 : 2 * left * right / (left + right);
  });
  const f = exact - settled;
  const currentPrice = next === settled ? candles[settled]!.c
    : (2*f**3 - 3*f**2 + 1)*candles[settled]!.c + (f**3 - 2*f**2 + f)*slopes[settled]!
      + (-2*f**3 + 3*f**2)*candles[next]!.c + (f**3 - f**2)*slopes[next]!;
  const visibleCount = Math.min(candles.length, maxVisible);
  const first = Math.max(0, exact - visibleCount + 1);
  const forming = candles[next]!;
  const formingHigh = Math.max(forming.o, currentPrice);
  const formingLow = Math.min(forming.o, currentPrice);
  const bounds = (start: number) => {
    let low = currentPrice;
    let high = currentPrice;
    for (let index = start; index <= settled; index++) {
      low = Math.min(low, candles[index]!.l);
      high = Math.max(high, candles[index]!.h);
    }
    if (next > settled && exact > settled) {
      low = Math.min(low, formingLow);
      high = Math.max(high, formingHigh);
    }
    return { low, high };
  };
  // Ease the departing left-edge candle out of the range to prevent scale jumps.
  const a = bounds(Math.floor(first));
  const b = bounds(Math.ceil(first));
  const shift = first - Math.floor(first);
  const minimum = a.low + (b.low - a.low) * shift;
  const maximum = a.high + (b.high - a.high) * shift;
  const span = Math.max(maximum - minimum, Math.abs(currentPrice) * .04, 1e-18);
  return { slopes, exact, settled, next, currentPrice, formingHigh, formingLow, visibleCount, first, low: minimum - span * .14, high: maximum + span * .14 };
}

/** Same open → close indexing and forming wick rules as the chart feature. */
export function walletCandleReplay(candles: BirdeyeCandle[], progress: number, maxVisible = 64) {
  const base = walletPriceReplay(candles, progress, maxVisible);
  const exact = Math.max(0, Math.min(1, progress)) * candles.length;
  const closedBars = Math.min(candles.length, Math.floor(exact));
  const formingIndex = Math.min(candles.length - 1, closedBars);
  const start = closedBars === 0 ? candles[0]!.o : candles[closedBars - 1]!.c;
  const fraction = exact - Math.floor(exact);
  const mix = fraction * fraction * (3 - 2 * fraction);
  const currentPrice = closedBars === candles.length ? candles.at(-1)!.c : start + (candles[formingIndex]!.c - start) * mix;
  const visibleCount = Math.min(candles.length + 1, maxVisible);
  const first = Math.max(0, exact - visibleCount + 1);
  const bounds = (pointStart: number) => {
    let low = Math.min(candles[formingIndex]!.o, currentPrice);
    let high = Math.max(candles[formingIndex]!.o, currentPrice);
    for (let bar = Math.max(0, pointStart - 1); bar < closedBars; bar++) {
      low = Math.min(low, candles[bar]!.l);
      high = Math.max(high, candles[bar]!.h);
    }
    return { low, high };
  };
  const a = bounds(Math.floor(first));
  const b = bounds(Math.ceil(first));
  const shift = first - Math.floor(first);
  const low = a.low + (b.low - a.low) * shift;
  const high = a.high + (b.high - a.high) * shift;
  const span = Math.max(high - low, currentPrice * .04, 1e-18);
  return { ...base, exact, settled: Math.min(candles.length - 1, closedBars), next: formingIndex, currentPrice, visibleCount, first, low: low - span * .14, high: high + span * .14, closedBars, formingIndex };
}
