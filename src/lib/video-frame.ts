import type { BirdeyeCandle } from '@/server/birdeye/types';
import type { LedgerEvent } from '@/server/pnl/ledger';
import type { BoardRow } from '@/server/services/analyze-token';
import type { ReplayTimeframe } from './replay-timeframe';
import type { EventBins } from './replay-window';
import { activeLabels, burstValueAt, compactAmount, compactUsd, formatPrice, signedUsd, type FillBurst, type VideoTimeline } from './video-scene';
import { drawLogo, drawNumber, drawTokenAvatar, fitText, font, numberWidth, roundRect, videoColors, type Rect, type VideoShape, type VideoTheme } from './frame-kit';
import { paintVideoBackground, type VideoBackgroundId } from './video-background';
import { walletCandleReplay, walletPriceReplay } from './wallet-price-replay';
import { drawWalletResultCard } from './wallet-result-card';
import { walletCardLayout } from './wallet-card-layout';
import { entryMarketCap, formatMultiple, type WalletTag } from './wallet-tags';
import { tradeValueInUnit, walletTradeTotals, walletVideoMetrics, type QuoteUnit } from './wallet-video-metrics';

export { VIDEO_FORMATS, type VideoShape, type VideoTheme } from './frame-kit';
export type ChartAxis = 'price' | 'mcap';
export type ChartStyle = 'line' | 'candles';

export interface VideoScene {
  shape: VideoShape;
  symbol: string;
  wallet: string;
  solPriceUsd: number;
  candles: BirdeyeCandle[];
  timeframe: ReplayTimeframe;
  row: BoardRow;
  events: LedgerEvent[];
  bins: EventBins;
  bursts: FillBurst[];
  timeline: VideoTimeline;
  holdSeconds: number;
  unit: QuoteUnit;
  effects: boolean;
  markers: boolean;
  basis: string;
  logo: CanvasImageSource | null;
  pnlPath?: Array<{ t: number; totalUsd: number }>;
  tokenLogo?: CanvasImageSource | null;
  walletRole?: string;
  tags?: WalletTag[];
  circulatingSupply?: number;
  axis?: ChartAxis;
  chartStyle?: ChartStyle;
  videoTheme?: VideoTheme;
  videoBackground?: VideoBackgroundId;
  customBackgroundColor?: string;
  demo?: boolean;
}

type Colors = ReturnType<typeof videoColors>;
const timeLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left') {
  ctx.font = font(weight, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
  ctx.textAlign = 'left';
}

function surface(ctx: CanvasRenderingContext2D, R: Rect, radius: number, fill: string, border?: string) {
  roundRect(ctx, R.x, R.y, R.w, R.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function badge(ctx: CanvasRenderingContext2D, side: 'buy' | 'sell', x: number, y: number, radius: number, C: Colors) {
  const color = side === 'buy' ? C.brand : C.loss;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = C.surface; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.font = font(600, radius * 1.12);
  ctx.fillText(side === 'buy' ? 'B' : 'S', x, y + radius * .04);
  ctx.restore();
}

function pnlColor(value: number, C: Colors) { return value < 0 ? C.loss : C.brand; }

export function drawMessage(ctx: CanvasRenderingContext2D, message: string): void {
  const { width, height } = ctx.canvas;
  const C = videoColors('dark');
  ctx.fillStyle = C.ground; ctx.fillRect(0, 0, width, height);
  text(ctx, message, width / 2, height / 2, Math.min(width, height) * .03, C.text2, 500, 'center');
}

/** One deterministic card renderer for the workspace and the exported video. */
export function drawVideoFrame(ctx: CanvasRenderingContext2D, t: number, scene: VideoScene): void {
  const theme = scene.videoTheme ?? 'dark';
  const C = videoColors(theme);
  const L = walletCardLayout(scene.shape);
  const { w, h, u, header: H, plot: P, summary: S } = L;
  const footerColor = paintVideoBackground(ctx, w, h, scene.videoBackground, theme, scene.customBackgroundColor);
  surface(ctx, L.card, 40 * u, C.ground);
  if (theme === 'dark') {
    ctx.save(); roundRect(ctx, L.card.x, L.card.y, L.card.w, L.card.h, 40 * u); ctx.clip();
    const tint = ctx.createRadialGradient(w, h, 0, w, h, h * .9);
    tint.addColorStop(0, 'rgba(0, 55, 38, .7)'); tint.addColorStop(1, 'rgba(0, 55, 38, 0)');
    ctx.fillStyle = tint; ctx.fillRect(L.card.x, L.card.y, L.card.w, L.card.h); ctx.restore();
  }
  const candles = scene.candles;
  if (candles.length < 2) return;
  const complete = t >= scene.timeline.replaySeconds;
  const reveal = Math.max(0, Math.min(1, t / scene.timeline.replaySeconds));
  const priceState = scene.chartStyle === 'candles'
    ? walletCandleReplay(candles, reveal, scene.shape === 'landscape' ? 100 : 64)
    : walletPriceReplay(candles, reveal, scene.shape === 'landscape' ? 100 : 64);
  const { settled, currentPrice } = priceState;
  const currentEvents = complete ? scene.events : scene.events.filter((_, index) => (scene.bins.bars[index] ?? -1) <= settled);
  const metrics = walletVideoMetrics({ row: scene.row, events: scene.events, currentEvents, currentPrice, finalPrice: candles.at(-1)!.c, reveal });
  const totalsArgs = { row: scene.row, events: scene.events, currentEvents, reveal, solPriceUsd: scene.solPriceUsd };
  const totalsUsd = walletTradeTotals({ ...totalsArgs, unit: 'USDC' });
  const totals = scene.unit === 'USDC' ? totalsUsd : walletTradeTotals({ ...totalsArgs, unit: scene.unit });
  const unitText = (value: number) => scene.unit === 'USDC' ? compactUsd(value) : compactAmount(value, 'SOL');
  let entryPrice = scene.row.avgBuyPrice;
  if (scene.row.audit) {
    const buys = currentEvents.filter(event => event.kind === 'buy');
    const quantity = buys.reduce((sum, event) => sum + event.quantity, 0);
    entryPrice = quantity > 0 ? buys.reduce((sum, event) => sum + event.valueUsd, 0) / quantity : 0;
  } else if (!currentEvents.some(event => event.kind === 'buy') && scene.events.some(event => event.kind === 'buy')) entryPrice = 0;
  const entryCap = entryMarketCap(entryPrice, scene.circulatingSupply);
  const entry = entryCap === null ? { label: 'Avg entry', value: entryPrice > 0 ? formatPrice(entryPrice) : '—' } : { label: 'Entry market cap', value: compactUsd(entryCap) };

  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, H.x, H.y, 68 * u, C);
  fitText(ctx, `$${scene.symbol}`, H.x + 88 * u, H.y + 42 * u, H.w * .59 - 88 * u, 600, 42 * u, C.text);
  text(ctx, `${candles.length} × ${scene.timeframe} intervals`, H.x + 88 * u, H.y + 78 * u, 21 * u, C.text2);
  // Two rows that mirror the left side: wallet + role pill level with the
  // symbol, the Birdeye Data logo level with the interval line.
  const right = H.x + H.w;
  const wallet = `${scene.wallet.slice(0, 6)}…${scene.wallet.slice(-6)}`;
  const role = scene.walletRole ?? 'Trader';
  ctx.font = font(500, 17 * u);
  const pillW = ctx.measureText(role).width + 24 * u;
  surface(ctx, { x: right - pillW, y: H.y + 12 * u, w: pillW, h: 30 * u }, 15 * u, C.raised);
  text(ctx, role, right - pillW / 2, H.y + 33 * u, 17 * u, C.text2, 500, 'center');
  text(ctx, wallet, right - pillW - 12 * u, H.y + 35 * u, 22 * u, C.text2, 500, 'right');
  drawLogo(ctx, scene.logo, right, H.y + 58 * u, 24 * u, 'right');
  if (scene.demo) text(ctx, 'Sample data', H.x, H.y + H.h + 12 * u, 18 * u, C.text3);

  drawPriceChart(ctx, scene, P, C, u, { ...priceState, avgCostUsd: metrics.avgCostUsd });
  drawCallout(ctx, t, scene, L.callout, C, u, complete, metrics);

  ctx.strokeStyle = C.lineStrong; ctx.lineWidth = u;
  ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(S.x + S.w, S.y); ctx.stroke();
  text(ctx, complete ? 'Total PnL' : 'Current PnL', S.x, S.y + 34 * u, 22 * u, C.text2);
  const totalText = signedUsd(metrics.totalUsd);
  ctx.font = font(500, 68 * u);
  const totalFit = Math.min(1, S.w * .72 / numberWidth(ctx, totalText));
  ctx.font = font(500, 68 * u * totalFit); ctx.fillStyle = pnlColor(metrics.totalUsd, C);
  drawNumber(ctx, totalText, S.x, S.y + 108 * u);
  const multiple = totalsUsd.bought > 0 ? formatMultiple((totalsUsd.bought + metrics.totalUsd) / totalsUsd.bought) : null;
  if (multiple) {
    ctx.font = font(600, 27 * u);
    const width = numberWidth(ctx, multiple) + 28 * u;
    const color = pnlColor(metrics.totalUsd, C);
    surface(ctx, { x: S.x + S.w - width, y: S.y + 68 * u, w: width, h: 46 * u }, 23 * u, color);
    text(ctx, multiple, S.x + S.w - width / 2, S.y + 100 * u, 27 * u, C.badgeText, 600, 'center');
  }
  const stats = [{ label: 'Invested', value: unitText(totals.bought) }, entry, { label: 'Sold', value: unitText(totals.sold) }];
  stats.forEach((stat, index) => {
    const x = S.x + index * S.w / 3;
    text(ctx, stat.label, x, S.y + 154 * u, 19 * u, C.text3, 400);
    fitText(ctx, stat.value, x, S.y + 195 * u, S.w / 3 - 24 * u, 500, 32 * u, C.text);
  });
  text(ctx, 'Birdeye Replayer', L.card.x + 8 * u, L.footerY, 28 * u, footerColor, 600);
  text(ctx, 'Solana · UTC', w - L.card.x - 8 * u, L.footerY, 22 * u, footerColor, 500, 'right');
  if (complete) drawWalletResultCard(ctx, t, scene, {
    totals, totalsUsd, unitText,
    entry: { label: entry.label.toUpperCase(), text: entry.value },
    role: scene.walletRole ?? 'trader',
  });
}

function drawPriceChart(ctx: CanvasRenderingContext2D, scene: VideoScene, P: Rect, C: Colors, u: number, state: ReturnType<typeof walletPriceReplay> & { closedBars?: number; formingIndex?: number; avgCostUsd?: number }) {
  const { exact, settled, currentPrice } = state;
  const candles = scene.candles;
  const rising = currentPrice >= candles[0]!.o;
  const priceColor = rising ? C.brand : C.loss;
  const priceRgb = rising ? C.brandRgb : C.lossRgb;
  const count = state.visibleCount;
  const first = state.first;
  const gutter = 164 * u;
  const plotW = P.w - gutter;
  const top = P.y + 24 * u;
  const bottom = P.y + P.h - 54 * u;
  const { low, high } = state;
  const yAt = (price: number) => bottom - (price - low) / (high - low) * (bottom - top);
  const xAt = (index: number) => P.x + (index - first) / Math.max(count - 1, 1) * plotW;
  const headX = xAt(exact);
  const headY = yAt(currentPrice);
  const axis = (price: number) => scene.axis === 'mcap' && (scene.circulatingSupply ?? 0) > 0 ? compactUsd(price * scene.circulatingSupply!) : formatPrice(price);
  for (let index = 0; index < 3; index++) {
    const price = low + (high - low) * (index + .5) / 3;
    const y = yAt(price);
    ctx.strokeStyle = C.line; ctx.lineWidth = u;
    ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.stroke();
    if (Math.abs(y - headY) > 60 * u) text(ctx, axis(price), P.x + P.w, y - 12 * u, 20 * u, C.text3, 500, 'right');
  }
  ctx.save(); ctx.beginPath(); ctx.rect(P.x, top, plotW + 6 * u, bottom - top); ctx.clip();
  if (scene.chartStyle === 'candles') {
    // Keep the body, wick and partial-candle geometry identical to the chart feature.
    const bodyW = Math.max(3 * u, Math.min(12 * u, plotW / (count - 1) * .58));
    const closedBars = state.closedBars ?? settled;
    for (let bar = Math.max(0, Math.floor(first) - 1); bar <= Math.min(closedBars, candles.length - 1); bar++) {
      const candle = candles[bar]!;
      const closed = bar < closedBars;
      const close = closed ? candle.c : currentPrice;
      const x = closed ? xAt(bar + 1) : headX;
      const high = closed ? candle.h : Math.max(candle.o, close);
      const low = closed ? candle.l : Math.min(candle.o, close);
      ctx.fillStyle = ctx.strokeStyle = close >= candle.o ? C.brand : C.loss;
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.moveTo(x, yAt(high)); ctx.lineTo(x, yAt(low)); ctx.stroke();
      ctx.fillRect(x - bodyW / 2, Math.min(yAt(candle.o), yAt(close)), bodyW, Math.max(2 * u, Math.abs(yAt(close) - yAt(candle.o))));
    }
  } else {
    const points: Array<{ x: number; y: number; bar: number }> = [];
    for (let index = Math.max(0, Math.floor(first)); index <= settled; index++) points.push({ x: xAt(index), y: yAt(candles[index]!.c), bar: index });
    if (exact > settled) points.push({ x: headX, y: headY, bar: state.next });
    const trace = () => {
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!;
        const b = points[index]!;
        const control1Y = yAt(candles[a.bar]!.c + state.slopes[a.bar]! / 3);
        const control2Y = yAt(candles[b.bar]!.c - state.slopes[b.bar]! / 3);
        if (index === points.length - 1 && exact > settled) {
          // Split the same cubic used by the price calculation at the live tip.
          const fraction = exact - settled;
          const dx = (xAt(state.next) - a.x) / 3;
          const q0Y = a.y + (control1Y - a.y) * fraction;
          const q1Y = control1Y + (control2Y - control1Y) * fraction;
          const r0Y = q0Y + (q1Y - q0Y) * fraction;
          ctx.bezierCurveTo(a.x + dx * fraction, q0Y, a.x + 2 * dx * fraction, r0Y, b.x, b.y);
        } else {
          const dx = (b.x - a.x) / 3;
          ctx.bezierCurveTo(a.x + dx, control1Y, b.x - dx, control2Y, b.x, b.y);
        }
      }
    };
    ctx.beginPath(); trace(); ctx.lineTo(headX, bottom); ctx.lineTo(points[0]!.x, bottom); ctx.closePath();
    ctx.fillStyle = `rgba(${priceRgb}, .045)`; ctx.fill();
    ctx.beginPath(); trace();
    ctx.strokeStyle = priceColor; ctx.lineWidth = 5 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  if (scene.markers && state.avgCostUsd && state.avgCostUsd > low && state.avgCostUsd < high) {
    const y = yAt(state.avgCostUsd);
    ctx.setLineDash([4 * u, 7 * u]); ctx.strokeStyle = C.text3; ctx.lineWidth = u;
    ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(headX, y); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, `Avg cost ${axis(state.avgCostUsd)}`, P.x + 8 * u, y - 10 * u, 18 * u, C.text3);
  }
  if (scene.markers) {
    for (const [bar, fills] of scene.bins.fills) {
      if (bar < first || bar > settled) continue;
      const x = xAt(bar + (scene.chartStyle === "candles" ? 1 : 0));
      if (x < P.x + 18 * u || x > P.x + plotW - 18 * u) continue;
      const lineY = yAt(candles[bar]!.c);
      for (const side of ['buy', 'sell'] as const) {
        if (fills[side].length === 0) continue;
        const pinY = Math.max(top + 22 * u, Math.min(bottom - 22 * u, lineY + (side === 'buy' ? 42 : -42) * u));
        ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x, pinY); ctx.stroke();
        badge(ctx, side, x, pinY, 18 * u, C);
      }
    }
  }
  ctx.restore();
  ctx.save(); ctx.setLineDash([7 * u, 8 * u]); ctx.lineWidth = 1.5 * u; ctx.strokeStyle = `rgba(${priceRgb}, .5)`;
  ctx.beginPath(); ctx.moveTo(headX, headY); ctx.lineTo(P.x + P.w, headY); ctx.stroke(); ctx.restore();
  ctx.beginPath(); ctx.arc(headX, headY, 6 * u, 0, Math.PI * 2); ctx.fillStyle = priceColor; ctx.fill();
  ctx.font = font(600, 24 * u);
  const value = axis(currentPrice);
  const width = Math.min(gutter - 8 * u, numberWidth(ctx, value) + 24 * u);
  surface(ctx, { x: P.x + P.w - width, y: headY - 23 * u, w: width, h: 46 * u }, 12 * u, priceColor);
  fitText(ctx, value, P.x + P.w - width + 12 * u, headY + 8 * u, width - 24 * u, 600, 24 * u, C.badgeText);
  for (const fraction of [0, .5, 1]) {
    const index = Math.min(candles.length - 1, Math.max(0, Math.round(first + (count - 1) * fraction)));
    text(ctx, timeLabel.format(candles[index]!.unixTime * 1000), P.x + plotW * fraction, P.y + P.h - 4 * u, 18 * u, C.text3, 500, fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center');
  }
}

function drawCallout(ctx: CanvasRenderingContext2D, t: number, scene: VideoScene, R: Rect, C: Colors, u: number, complete: boolean, metrics: { realizedUsd: number; unrealizedUsd: number }) {
  if (complete) {
    [{ label: 'Realized PnL', value: metrics.realizedUsd }, { label: 'Unrealized PnL', value: metrics.unrealizedUsd }].forEach((stat, index) => {
      const x = R.x + index * R.w / 2;
      text(ctx, stat.label, x, R.y + 23 * u, 19 * u, C.text3, 400);
      fitText(ctx, signedUsd(stat.value), x, R.y + 59 * u, R.w / 2 - 28 * u, 500, 30 * u, pnlColor(stat.value, C));
    });
    return;
  }
  const active = scene.effects ? activeLabels(scene.bursts, t, scene.holdSeconds).at(-1) : undefined;
  const values = active ? burstValueAt(active.burst, t, event => tradeValueInUnit(event, scene.unit, scene.solPriceUsd)) : null;
  const items = values ? [
    ...(values.buy > 0 ? [{ side: 'buy' as const, value: values.buy, count: values.buys }] : []),
    ...(values.sell > 0 ? [{ side: 'sell' as const, value: values.sell, count: values.sells }] : []),
  ] : [];
  if (items.length === 0) {
    fitText(ctx, scene.basis, R.x, R.y + 37 * u, R.w * .75, 400, 21 * u, C.text2);
    const count = scene.events.filter(event => event.kind === 'buy' || event.kind === 'sell').length;
    text(ctx, `${count} trades`, R.x + R.w, R.y + 37 * u, 20 * u, C.text3, 500, 'right');
    return;
  }
  items.forEach((item, index) => {
    const cellW = R.w / items.length;
    const x = R.x + index * cellW;
    badge(ctx, item.side, x + 17 * u, R.y + 34 * u, 16 * u, C);
    const value = scene.unit === 'USDC' ? compactUsd(item.value) : compactAmount(item.value, 'SOL');
    text(ctx, `${item.side === 'buy' ? 'Buy' : 'Sell'} · ${item.count} fill${item.count === 1 ? '' : 's'}`, x + 44 * u, R.y + 25 * u, 20 * u, C.text2);
    fitText(ctx, value, x + 44 * u, R.y + 56 * u, cellW - 60 * u, 600, 28 * u, item.side === 'buy' ? C.brand : C.loss);
  });
}
