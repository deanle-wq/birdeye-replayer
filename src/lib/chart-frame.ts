import type { BirdeyeCandle } from '@/server/birdeye/types';
import { activeLabels, burstEventsAt, compactUsd, easeOutCubic, easeOutExpo, formatChange, formatPrice, OUTRO, shortAddress, smoothstep, visibleTagBars, type TagBurst, type VideoTimeline } from './chart-scene';
import { LAYER_INFO, tagSummary, type EventBar, type TagEvent } from './chart-tags';
import { chartResultMetrics, type ChartAxis } from './chart-result';
import { videoColors, drawLogo, drawNumber, drawTokenAvatar, fitText, font, numberWidth, roundRect, type Rect, type VideoShape, type VideoTheme } from './frame-kit';
import { DARK_THEME } from './design-system';
import { paintVideoBackground, type VideoBackgroundId } from './video-background';
import { resultCardLayout, videoLayout } from './video-layout';
import type { VideoIconName, VideoIcons } from './video-icons';
import { lineReplay } from './line-replay';

export { VIDEO_FORMATS, drawMessage, type VideoShape, type VideoTheme } from './frame-kit';
export type { ChartAxis } from './chart-result';
export type ChartStyle = 'line' | 'candles';
export interface ChartScene {
  shape: VideoShape;
  chartStyle: ChartStyle;
  videoTheme: VideoTheme;
  videoBackground?: VideoBackgroundId;
  customBackgroundColor?: string;
  symbol: string;
  name?: string;
  tokenLogo?: CanvasImageSource | null;
  logo: CanvasImageSource | null;
  icons?: VideoIcons;
  demo?: boolean;
  candles: BirdeyeCandle[];
  rangeLabel: string;
  dateLabel: string;
  axis: ChartAxis;
  circulatingSupply?: number;
  bars: EventBar[];
  barEvents: Map<number, TagEvent[]>;
  bursts: TagBurst[];
  events: TagEvent[];
  timeline: VideoTimeline;
  holdSeconds: number;
  effects: boolean;
  markers: boolean;
}

const timeLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string = DARK_THEME.text, weight = 500, align: CanvasTextAlign = 'left') {
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
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
}
function icon(ctx: CanvasRenderingContext2D, scene: ChartScene, name: VideoIconName, x: number, y: number, size: number) {
  const image = scene.icons?.[scene.videoTheme]?.[name];
  if (image) ctx.drawImage(image, x, y, size, size);
}

/** Same deterministic renderer for the studio and the exported file. */
export function drawChartFrame(ctx: CanvasRenderingContext2D, t: number, scene: ChartScene): void {
  const C = videoColors(scene.videoTheme);
  const L = videoLayout(scene.shape);
  const { w, h, u, header: H, plot: P, summary: S } = L;
  const candles = scene.candles;
  const footerColor = paintVideoBackground(ctx, w, h, scene.videoBackground, scene.videoTheme, scene.customBackgroundColor);
  surface(ctx, L.card, 40 * u, C.ground);
  // Subtle brand tint stays behind content, rather than adding another panel.
  if (scene.videoTheme === 'dark') {
    ctx.save();
    roundRect(ctx, L.card.x, L.card.y, L.card.w, L.card.h, 40 * u); ctx.clip();
    const tint = ctx.createRadialGradient(
      L.card.x + L.card.w, L.card.y + L.card.h, 0,
      L.card.x + L.card.w, L.card.y + L.card.h, L.card.h * .88,
    );
    tint.addColorStop(0, 'rgba(0, 55, 38, .78)');
    tint.addColorStop(.62, 'rgba(0, 55, 38, .16)');
    tint.addColorStop(1, 'rgba(0, 55, 38, 0)');
    ctx.fillStyle = tint; ctx.fillRect(L.card.x, L.card.y, L.card.w, L.card.h);
    ctx.restore();
  }
  if (candles.length < 2) return;

  const progress = Math.max(0, Math.min(1, t / scene.timeline.replaySeconds));
  const { values: prices, start, exact, settled, current } = lineReplay(candles, progress);
  const pointPrice = (index: number) => prices[index]!;
  const change = start > 0 ? current / start - 1 : 0;
  const up = change >= 0;
  const color = up ? C.brand : C.loss;
  const mcap = scene.axis === 'mcap' && (scene.circulatingSupply ?? 0) > 0;
  const priceText = (price: number) => mcap ? compactUsd(price * scene.circulatingSupply!) : formatPrice(price);
  const complete = t >= scene.timeline.replaySeconds;

  // One identity, one time context. The live value stays next to the chart line.
  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, H.x, H.y, 68 * u, C);
  fitText(ctx, `$${scene.symbol}`, H.x + 88 * u, H.y + 42 * u, H.w * .61 - 88 * u, 600, 42 * u, C.text);
  text(ctx, scene.rangeLabel.replace('CANDLES', 'INTERVALS'), H.x + 88 * u, H.y + 78 * u, 22 * u, C.text2);
  const right = H.x + H.w;
  text(ctx, dayLabel.format(candles.at(-1)!.unixTime * 1000), right, H.y + 24 * u, 22 * u, C.text3, 500, 'right');
  drawLogo(ctx, scene.logo, right, H.y + 49 * u, 25 * u, 'right');
  if (scene.demo) text(ctx, 'Sample data', H.x, H.y + H.h + 12 * u, 18 * u, C.text3);

  // A quiet line chart with a stable scale; revealed markers remain with their candle.
  const visible = Math.min(prices.length, L.wide ? 100 : 64);
  const first = Math.max(0, exact - visible + 1);
  const gutter = (mcap ? 156 : 172) * u;
  const plotW = P.w - gutter;
  const plotRight = P.x + P.w;
  const chartTop = P.y + 24 * u;
  const chartBottom = P.y + P.h - 54 * u;
  const minPrice = Math.min(...(scene.chartStyle === 'candles' ? candles.map(c => c.l) : prices));
  const maxPrice = Math.max(...(scene.chartStyle === 'candles' ? candles.map(c => c.h) : prices));
  const span = Math.max(maxPrice - minPrice, start * .04, 1e-18);
  const low = minPrice - span * .18;
  const high = maxPrice + span * .18;
  const yAt = (price: number) => chartBottom - (price - low) / (high - low) * (chartBottom - chartTop);
  const xAt = (index: number) => P.x + (index - first) / (visible - 1) * plotW;
  const headX = xAt(exact);
  const headY = yAt(current);

  for (let i = 0; i < 3; i++) {
    const price = low + (high - low) * (i + .5) / 3;
    const y = yAt(price);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = u;
    ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.stroke();
    if (Math.abs(y - headY) > 62 * u) text(ctx, priceText(price), plotRight, y - 12 * u, 20 * u, C.text3, 500, 'right');
  }
  const points = [];
  for (let i = Math.max(0, Math.floor(first)); i <= settled; i++) points.push({ x: xAt(i), y: yAt(pointPrice(i)) });
  points.push({ x: headX, y: headY });
  ctx.save();
  ctx.beginPath(); ctx.rect(P.x, chartTop, plotW + 5 * u, chartBottom - chartTop); ctx.clip();
  if (scene.chartStyle === 'candles') {
    const bodyW = Math.max(3 * u, Math.min(12 * u, plotW / (visible - 1) * .58));
    for (let bar = Math.max(0, Math.floor(first) - 1); bar <= Math.min(settled, candles.length - 1); bar++) {
      const candle = candles[bar]!;
      const closed = bar < settled;
      const close = closed ? candle.c : current;
      const x = closed ? xAt(bar + 1) : headX;
      const high = closed ? candle.h : Math.max(candle.o, close);
      const low = closed ? candle.l : Math.min(candle.o, close);
      ctx.strokeStyle = ctx.fillStyle = close >= candle.o ? C.brand : C.loss;
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.moveTo(x, yAt(high)); ctx.lineTo(x, yAt(low)); ctx.stroke();
      ctx.fillRect(x - bodyW / 2, Math.min(yAt(candle.o), yAt(close)), bodyW, Math.max(2 * u, Math.abs(yAt(close) - yAt(candle.o))));
    }
  } else {
  ctx.beginPath(); ctx.moveTo(points[0]!.x, chartBottom);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(headX, chartBottom); ctx.closePath();
  ctx.fillStyle = up ? `rgba(${C.brandRgb}, .035)` : `rgba(${C.lossRgb}, .035)`;
  ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.strokeStyle = color; ctx.lineWidth = 6 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.restore();

  // The price badge has its own gutter and never covers the line or pins.
  ctx.save(); ctx.setLineDash([7 * u, 8 * u]); ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = up ? `rgba(${C.brandRgb}, .5)` : `rgba(${C.lossRgb}, .5)`;
  ctx.beginPath(); ctx.moveTo(headX, headY); ctx.lineTo(plotRight, headY); ctx.stroke(); ctx.restore();
  ctx.beginPath(); ctx.arc(headX, headY, 6 * u, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.font = font(600, 24 * u);
  const value = priceText(current);
  const badgeW = Math.min(gutter - 10 * u, numberWidth(ctx, value) + 24 * u);
  surface(ctx, { x: plotRight - badgeW, y: headY - 23 * u, w: badgeW, h: 46 * u }, 12 * u, color);
  fitText(ctx, value, plotRight - badgeW + 12 * u, headY + 8 * u, badgeW - 24 * u, 600, 24 * u, C.badgeText);

  if (scene.markers) {
    const visibleMarkers = visibleTagBars(scene.barEvents, first, settled)
      .filter(([bar]) => xAt(bar + 1) > P.x + 20 * u && xAt(bar + 1) < P.x + plotW - 20 * u);
    const placed: Array<{ x: number; y: number }> = [];
    for (const [bar, events] of visibleMarkers) {
      const event = [...events].sort((a, b) => b.usd - a.usd)[0];
      if (!event) continue;
      const x = xAt(bar + 1);
      const lineY = yAt(pointPrice(bar + 1));
      const direction = event.side === 'buy' ? 1 : -1;
      const preferredY = lineY + direction * 48 * u;
      const candidates = [preferredY];
      for (let lane = 1; lane <= 4; lane += 1) {
        candidates.push(preferredY + direction * lane * 46 * u, preferredY - direction * lane * 46 * u);
      }
      const pinY = candidates
        .map((candidate) => Math.max(chartTop + 23 * u, Math.min(chartBottom - 23 * u, candidate)))
        .find((candidate) => placed.every((pin) => Math.hypot(pin.x - x, pin.y - candidate) >= 46 * u))
        ?? Math.max(chartTop + 23 * u, Math.min(chartBottom - 23 * u, preferredY));
      placed.push({ x, y: pinY });
      const sideColor = event.side === 'buy' ? C.brand : C.loss;
      ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x, pinY); ctx.stroke();
      surface(ctx, { x: x - 21 * u, y: pinY - 21 * u, w: 42 * u, h: 42 * u }, 21 * u, C.surface, sideColor);
      icon(ctx, scene, event.layer, x - 13 * u, pinY - 13 * u, 26 * u);
    }
  }
  for (const fraction of [0, .5, 1]) {
    const index = Math.min(candles.length - 1, Math.max(0, Math.round(first + (visible - 1) * fraction) - 1));
    text(ctx, timeLabel.format(candles[index]!.unixTime * 1000), P.x + plotW * fraction, P.y + P.h - 4 * u, 18 * u, C.text3, 500, fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center');
  }

  drawTradeCallout(ctx, t, scene, L.callout, u, complete);

  // Price and change share one quiet baseline, inspired by the supplied card.
  // Keep the opening value secondary and the same hierarchy on the final hold.
  const top = S.y;
  ctx.strokeStyle = C.lineStrong; ctx.lineWidth = u;
  ctx.beginPath(); ctx.moveTo(S.x, top); ctx.lineTo(S.x + S.w, top); ctx.stroke();
  text(ctx, `${complete ? 'Close' : 'Current'} ${mcap ? 'market cap' : 'price'}`, S.x, top + 38 * u, 22 * u, C.text2);
  const priceSize = 64;
  ctx.font = font(500, priceSize * u);
  const currentValue = priceText(current);
  const priceFit = Math.min(1, S.w * .54 / numberWidth(ctx, currentValue));
  ctx.font = font(500, priceSize * u * priceFit); ctx.fillStyle = C.text;
  drawNumber(ctx, currentValue, S.x, top + 108 * u);

  const changeValue = formatChange(change);
  const changeSize = 42 * u;
  ctx.font = font(500, changeSize);
  const changeRight = S.x + S.w;
  const changeY = top + 106 * u;
  ctx.fillStyle = color; drawNumber(ctx, changeValue, changeRight, changeY, 'right');
  text(ctx, `Open ${priceText(start)}`, S.x, top + 150 * u, 21 * u, C.text3);
  if (complete) text(ctx, 'Replay complete', S.x + S.w, top + 150 * u, 18 * u, C.text3, 500, 'right');

  text(ctx, 'Birdeye Replayer', L.card.x + 8 * u, L.footerY, 28 * u, footerColor, 600);
  text(ctx, 'Solana · UTC', w - L.card.x - 8 * u, L.footerY, 22 * u, footerColor, 500, 'right');

  if (complete) drawResultCard(ctx, t, scene, L.card, u);
}

function drawResultCard(ctx: CanvasRenderingContext2D, t: number, scene: ChartScene, card: Rect, u: number) {
  const C = videoColors(scene.videoTheme);
  const result = chartResultMetrics(scene.candles, scene.axis, scene.circulatingSupply);
  if (!result) return;

  const phase = Math.max(0, Math.min(1, (t - scene.timeline.replaySeconds) / scene.timeline.outroSeconds));
  const appear = easeOutCubic((phase - OUTRO.appearStart) / OUTRO.appearSpan);
  const veil = smoothstep(phase / OUTRO.veil);
  const count = smoothstep((phase - OUTRO.countStart) / (OUTRO.countEnd - OUTRO.countStart));
  const settle = easeOutExpo((phase - OUTRO.appearStart) / OUTRO.appearSpan);
  const sparkProgress = easeOutCubic((phase - .18) / .64);
  const color = result.change >= 0 ? C.brand : C.loss;

  ctx.save();
  roundRect(ctx, card.x, card.y, card.w, card.h, 40 * u);
  ctx.clip();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.78 * veil})`;
  ctx.fillRect(card.x, card.y, card.w, card.h);
  ctx.restore();

  const scale = .965 + .035 * settle;
  const hasPills = [...tagSummary(scene.events).values()].some((value) => value.buyUsd !== value.sellUsd);
  const A = resultCardLayout(card, scene.shape, u, scale, hasPills);
  const R = A.card;

  ctx.save();
  ctx.globalAlpha = appear;
  ctx.shadowColor = 'rgba(0, 0, 0, .28)';
  ctx.shadowBlur = 42 * u;
  surface(ctx, R, 36 * u, C.ground, color);
  ctx.shadowColor = 'transparent';

  const left = A.inner.x;
  const right = A.inner.x + A.inner.w;
  const center = R.x + R.w / 2;
  const avatar = Math.min(66 * u, A.header.h);
  const headerY = A.header.y + (A.header.h - avatar) / 2;
  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, left, headerY, avatar, C);
  const nameX = left + avatar + 20 * u;
  const headerGap = 20 * u;
  fitText(ctx, `$${scene.symbol}`, nameX, headerY + avatar * .66, Math.max(80 * u, center - headerGap - nameX), 600, Math.min(40 * u, R.h * .047), C.text);

  const contextSize = Math.min(19 * u, R.h * .022);
  text(ctx, scene.rangeLabel, right, headerY + avatar * .28, contextSize, C.text2, 600, 'right');
  fitRightText(ctx, scene.dateLabel, right, headerY + avatar * .72, right - center - headerGap, 500, contextSize, C.text3);

  const valueLabel = result.axis === 'mcap' ? 'MARKET CAP CHANGE' : 'PRICE CHANGE';
  text(ctx, valueLabel, center, A.change.y + 24 * u, Math.min(22 * u, R.h * .025), C.text3, 600, 'center');
  const changeValue = formatChange(result.change * count);
  const changeSize = Math.min(R.w * .145, R.h * .145);
  ctx.font = font(600, changeSize);
  ctx.fillStyle = color;
  drawNumber(ctx, changeValue, center, A.change.y + A.change.h * .86, 'center');

  if (A.pills) drawResultPills(ctx, scene, center, A.pills.y, Math.min(A.pills.w, 720 * u), u);

  ctx.strokeStyle = C.lineStrong;
  ctx.lineWidth = u;
  ctx.beginPath(); ctx.moveTo(A.divider.x, A.divider.y); ctx.lineTo(A.divider.x + A.divider.w, A.divider.y); ctx.stroke();

  const metricLabel = result.axis === 'mcap' ? ['OPEN MC', 'CLOSE MC', 'HIGH MC'] : ['OPEN', 'CLOSE', 'HIGH'];
  const metricValue = (value: number) => result.axis === 'mcap' ? compactUsd(value) : formatPrice(value);
  const colA = A.metrics.x + A.metrics.w * .25;
  const colB = A.metrics.x + A.metrics.w * .75;
  const rowA = A.metrics.y + 18 * u;
  const rowB = A.metrics.y + A.metrics.h / 2 + 18 * u;
  drawMetric(ctx, metricLabel[0]!, metricValue(result.open), colA, rowA, A.metrics.w * .4, u, C);
  drawMetric(ctx, metricLabel[1]!, metricValue(result.close), colB, rowA, A.metrics.w * .4, u, C);
  drawMetric(ctx, metricLabel[2]!, metricValue(result.high), colA, rowB, A.metrics.w * .4, u, C);
  drawMetric(ctx, 'VOLUME', compactUsd(result.volumeUsd), colB, rowB, A.metrics.w * .4, u, C);

  drawResultSparkline(ctx, scene.candles.map((candle) => candle.c), A.sparkline, color, C.lineStrong, u, sparkProgress);

  const footerY = A.footer.y + A.footer.h * .72;
  drawLogo(ctx, scene.logo, A.footer.x, A.footer.y + (A.footer.h - 30 * u) / 2, 30 * u, 'left');
  text(ctx, 'Birdeye Replayer · Powered by Birdeye Data API', A.footer.x + A.footer.w, footerY, Math.min(17 * u, R.h * .019), C.text3, 500, 'right');
  ctx.restore();
}

function fitRightText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxW: number, weight: number, size: number, color: string) {
  ctx.font = font(weight, size);
  const fit = Math.min(1, maxW / Math.max(ctx.measureText(value).width, 1));
  text(ctx, value, x, y, size * fit, color, weight, 'right');
}

function drawMetric(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, maxW: number, u: number, C: ReturnType<typeof videoColors>) {
  text(ctx, label, x, y, 17 * u, C.text3, 600, 'center');
  ctx.font = font(600, 34 * u);
  const fit = Math.min(1, maxW / Math.max(ctx.measureText(value).width, 1));
  ctx.font = font(600, 34 * u * fit);
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.fillText(value, x, y + 48 * u);
  ctx.textAlign = 'left';
}

function drawResultPills(ctx: CanvasRenderingContext2D, scene: ChartScene, center: number, y: number, maxW: number, u: number) {
  const C = videoColors(scene.videoTheme);
  const summaries = [...tagSummary(scene.events).entries()]
    .map(([layer, value]) => ({ layer, net: value.buyUsd - value.sellUsd }))
    .filter((item) => Math.abs(item.net) > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 2);
  if (!summaries.length) return;

  const gap = 12 * u;
  const height = 38 * u;
  const items = summaries.map((item) => {
    const value = `${LAYER_INFO[item.layer].label} net ${item.net >= 0 ? '+' : '−'}${compactUsd(Math.abs(item.net))}`;
    ctx.font = font(500, 16 * u);
    return { ...item, value, width: Math.min(maxW, ctx.measureText(value).width + 50 * u) };
  });
  const total = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
  let x = center - Math.min(total, maxW) / 2;
  for (const item of items) {
    const width = Math.min(item.width, maxW / items.length - gap / 2);
    surface(ctx, { x, y, w: width, h: height }, height / 2, C.surface, C.lineStrong);
    icon(ctx, scene, item.layer, x + 9 * u, y + 8 * u, 22 * u);
    fitText(ctx, item.value, x + 36 * u, y + 25 * u, width - 46 * u, 500, 16 * u, C.text2);
    x += width + gap;
  }
}

function drawResultSparkline(ctx: CanvasRenderingContext2D, values: number[], R: Rect, color: string, baseline: string, u: number, progress: number) {
  if (values.length < 2 || progress <= 0) return;
  const inheritedAlpha = ctx.globalAlpha;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, Math.abs(high) * .01, 1e-18);
  const xAt = (index: number) => R.x + index / (values.length - 1) * R.w;
  const yAt = (value: number) => R.y + R.h - (value - low) / span * R.h;
  const exact = Math.min(values.length - 1, Math.max(0, progress) * (values.length - 1));
  const settled = Math.floor(exact);
  const next = Math.min(values.length - 1, settled + 1);
  const current = values[settled]! + (values[next]! - values[settled]!) * smoothstep(exact - settled);
  const points = values.slice(0, settled + 1).map((value, index) => ({ x: xAt(index), y: yAt(value) }));
  if (exact > settled) points.push({ x: xAt(exact), y: yAt(current) });
  const head = points.at(-1)!;

  ctx.save();
  ctx.beginPath(); ctx.rect(R.x, R.y - 4 * u, R.w, R.h + 8 * u); ctx.clip();
  ctx.strokeStyle = baseline;
  ctx.lineWidth = u;
  ctx.beginPath(); ctx.moveTo(R.x, R.y + R.h); ctx.lineTo(R.x + R.w, R.y + R.h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(R.x, R.y + R.h);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(head.x, R.y + R.h); ctx.closePath();
  const fill = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
  fill.addColorStop(0, color);
  fill.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalAlpha = inheritedAlpha * .12;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = inheritedAlpha;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 4 * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath(); ctx.arc(head.x, head.y, 4 * u, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

function drawTradeCallout(ctx: CanvasRenderingContext2D, t: number, scene: ChartScene, R: Rect, u: number, complete: boolean) {
  const C = videoColors(scene.videoTheme);
  const labels = scene.effects && !complete ? activeLabels(scene.bursts, t, scene.holdSeconds) : [];
  const active = labels.at(-1);
  const events = active ? burstEventsAt(active.burst, t) : [];
  const event = [...events].sort((a, b) => b.usd - a.usd)[0];
  if (!event) {
    const count = scene.bars.reduce((sum, bar) => sum + bar.events.length, 0);
    icon(ctx, scene, complete ? 'check' : 'chart', R.x, R.y + 20 * u, 28 * u);
    text(ctx, complete ? 'Window complete' : scene.effects ? 'Following the price' : 'Price replay', R.x + 40 * u, R.y + 39 * u, 22 * u, C.text2);
    text(ctx, `${count} tracked moments`, R.x + R.w, R.y + 39 * u, 20 * u, C.text3, 500, 'right');
    return;
  }
  const color = event.side === 'buy' ? C.brand : C.loss;
  icon(ctx, scene, event.layer, R.x, R.y + 20 * u, 32 * u);
  const label = `${LAYER_INFO[event.layer].label} · ${event.side === 'buy' ? 'Buy' : 'Sell'}`;
  text(ctx, label, R.x + 46 * u, R.y + 30 * u, 22 * u, C.text, 500);
  const detail = event.names?.[0] ?? (event.wallet ? shortAddress(event.wallet) : event.wallets ? `${event.wallets} wallets · net flow` : 'Individual swap');
  fitText(ctx, detail, R.x + 46 * u, R.y + 56 * u, R.w * .62, 400, 18 * u, C.text3);
  text(ctx, compactUsd(event.usd), R.x + R.w, R.y + 44 * u, 28 * u, color, 600, 'right');
}
