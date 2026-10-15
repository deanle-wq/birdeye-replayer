import type { BirdeyeCandle } from '@/server/birdeye/types';
import { smoothstep } from './chart-scene';

/** Include the window open and every close; the final hold uses the real close. */
export function lineReplay(candles: BirdeyeCandle[], progress: number) {
  const start = candles[0]!.o || candles[0]!.c;
  const values = [start, ...candles.map((candle) => candle.c)];
  const exact = Math.max(0, Math.min(1, progress)) * (values.length - 1);
  const settled = Math.floor(exact);
  const next = Math.min(values.length - 1, settled + 1);
  const current = values[settled]! + (values[next]! - values[settled]!) * smoothstep(exact - settled);
  return { values, start, exact, settled, current };
}
