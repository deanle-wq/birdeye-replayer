import type { VideoScene } from './video-frame';
import { drawNumber, drawLogo, drawTokenAvatar, fitText, font, numberWidth, roundRect, videoColors } from './frame-kit';
import { walletResultLayout } from './wallet-card-layout';
import { easeOutCubic, OUTRO, signedUsd } from './video-scene';
import { formatMultiple } from './wallet-tags';

interface ResultValues {
  totals: { bought: number; sold: number };
  totalsUsd: { bought: number; sold: number };
  unitText: (value: number) => string;
  entry: { label: string; text: string };
  role: string;
}

function heroUsd(value: number): string {
  if (Math.abs(value) >= 10_000_000) return signedUsd(value);
  const body = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
  }).format(Math.abs(value || 0));
  return `${value < 0 ? '−' : '+'}${body}`;
}

/** Plata-inspired hierarchy on the same opaque surface as the replay. */
export function drawWalletResultCard(ctx: CanvasRenderingContext2D, t: number, scene: VideoScene, values: ResultValues) {
  const C = videoColors(scene.videoTheme ?? 'dark');
  const L = walletResultLayout(scene.shape);
  const { u, card, header, hero, plot, stats, footer, columns, rowHeight } = L;
  const x = header.x;
  const right = x + header.w;
  const total = scene.row.totalUsd;
  const color = (value: number) => value < 0 ? C.loss : C.brand;
  const progress = (t - scene.timeline.replaySeconds) / scene.timeline.outroSeconds;
  const appear = easeOutCubic((progress - OUTRO.appearStart) / OUTRO.appearSpan);
  const count = easeOutCubic((progress - OUTRO.countStart) / (OUTRO.countEnd - OUTRO.countStart));
  const label = (text: string, atX: number, atY: number, size = 20 * u, fill = C.text3, align: CanvasTextAlign = 'left') => {
    ctx.font = font(400, size);
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.fillText(text, atX, atY);
    ctx.textAlign = 'left';
  };

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = appear;
  roundRect(ctx, card.x, card.y, card.w, card.h, 40 * u);
  ctx.fillStyle = C.ground;
  ctx.fill();

  // One compact identity row leaves the result and its chart in focus.
  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, x, header.y, 64 * u, C);
  fitText(ctx, `$${scene.symbol}`, x + 84 * u, header.y + 29 * u, header.w * .55 - 84 * u, 600, 32 * u, C.text);
  label(`Replay complete${scene.demo ? ' · Sample data' : ''}`, x + 84 * u, header.y + 58 * u, 18 * u, C.text2);
  label(`${scene.wallet.slice(0, 6)}…${scene.wallet.slice(-6)}`, right, header.y + 27 * u, 22 * u, C.text2, 'right');
  const role = values.role.charAt(0).toUpperCase() + values.role.slice(1);
  label(role, right, header.y + 57 * u, 18 * u, C.text3, 'right');

  label('Total PnL', x, hero.y + 24 * u, 24 * u, C.text2);
  ctx.font = font(500, L.heroSize);
  const numberSize = L.heroSize * Math.min(1, hero.w / Math.max(numberWidth(ctx, heroUsd(total)), 1));
  ctx.font = font(500, numberSize);
  ctx.fillStyle = color(total);
  drawNumber(ctx, heroUsd(total * count), x, hero.y + 46 * u + L.heroSize);

  const multiple = values.totalsUsd.bought > 0 ? (values.totalsUsd.bought + total) / values.totalsUsd.bought : null;
  const multipleText = formatMultiple(multiple === null ? null : 1 + (multiple - 1) * count);
  const chips = [
    ...(multipleText ? [{ text: multipleText, accent: true }] : []),
    ...(scene.tags ?? []).map(tag => ({ text: tag.label, accent: false })),
  ];
  const chipY = hero.y + 66 * u + L.heroSize;
  let chipX = x;
  ctx.font = font(500, 22 * u);
  for (const chip of chips) {
    const width = numberWidth(ctx, chip.text) + 30 * u;
    if (chipX + width > right) break;
    roundRect(ctx, chipX, chipY, width, 40 * u, 20 * u);
    ctx.fillStyle = chip.accent ? color(total) : C.raised;
    ctx.fill();
    ctx.fillStyle = chip.accent ? (total < 0 ? C.ground : C.badgeText) : C.text2;
    drawNumber(ctx, chip.text, chipX + 15 * u, chipY + 28 * u);
    chipX += width + 12 * u;
  }

  label('PnL across the replay', plot.x, plot.y - 24 * u, 20 * u, C.text2);
  // Fixed bounds throughout the count-up; the line ends at the exact final PnL.
  const endTime = scene.timeline.replaySeconds;
  const path = [
    { t: 0, totalUsd: 0 },
    ...(scene.pnlPath ?? []).filter(point => Number.isFinite(point.totalUsd) && point.t > 0 && point.t < endTime),
    { t: endTime, totalUsd: total },
  ];
  const all = path.map(point => point.totalUsd);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(max - min, 1e-9);
  const low = min - span * .14;
  const high = max + span * .14;
  const yOf = (value: number) => plot.y + (1 - (value - low) / (high - low)) * plot.h;
  const xOf = (time: number) => plot.x + (time / endTime) * (plot.w - 12 * u);
  const zeroY = yOf(0);
  ctx.lineWidth = u;
  ctx.strokeStyle = C.line;
  ctx.setLineDash([4 * u, 6 * u]);
  ctx.beginPath(); ctx.moveTo(plot.x, zeroY); ctx.lineTo(right, zeroY); ctx.stroke();
  ctx.setLineDash([]);
  label('$0', right, zeroY - 10 * u, 17 * u, C.text3, 'right');

  const revealedTime = endTime * count;
  const points = path.filter(point => point.t <= revealedTime);
  const next = path.find(point => point.t > revealedTime);
  const last = points.at(-1)!;
  if (next && revealedTime > last.t) {
    const fraction = (revealedTime - last.t) / (next.t - last.t);
    points.push({ t: revealedTime, totalUsd: last.totalUsd + (next.totalUsd - last.totalUsd) * fraction });
  }
  if (points.length > 1) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const px = xOf(point.t); const py = yOf(point.totalUsd);
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color(total);
    ctx.lineWidth = 3.5 * u;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    const tip = points.at(-1)!;
    ctx.beginPath(); ctx.arc(xOf(tip.t), yOf(tip.totalUsd), 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = color(total); ctx.fill();
  }

  const entryLabels: Record<string, string> = { 'ENTRY MARKET CAP': 'Entry market cap', 'ENTRY MC': 'Entry market cap', 'AVG ENTRY': 'Average entry' };
  const figures = [
    { label: 'Invested', text: values.unitText(values.totals.bought * count), color: C.text },
    { label: entryLabels[values.entry.label] ?? values.entry.label, text: values.entry.text, color: C.text },
    { label: 'Realized PnL', text: signedUsd(scene.row.realizedUsd * count), color: color(scene.row.realizedUsd) },
    { label: 'Unrealized PnL', text: signedUsd(scene.row.unrealizedUsd * count), color: color(scene.row.unrealizedUsd) },
  ];
  ctx.strokeStyle = C.line; ctx.lineWidth = u;
  for (let row = 0; row < Math.ceil(figures.length / columns); row++) {
    const top = stats.y + row * rowHeight;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(right, top); ctx.stroke();
  }
  const cellWidth = stats.w / columns;
  figures.forEach((figure, index) => {
    const cellX = stats.x + (index % columns) * cellWidth;
    const cellY = stats.y + Math.floor(index / columns) * rowHeight;
    label(figure.label, cellX, cellY + 32 * u, 19 * u);
    ctx.font = font(500, L.statSize);
    const size = L.statSize * Math.min(1, (cellWidth - 24 * u) / Math.max(numberWidth(ctx, figure.text), 1));
    ctx.font = font(500, size); ctx.fillStyle = figure.color;
    drawNumber(ctx, figure.text, cellX, cellY + 40 * u + L.statSize);
  });

  drawLogo(ctx, scene.logo, footer.x, footer.y, 30 * u, 'left');
  label('Birdeye Replayer · Solana', right, footer.y + 23 * u, 18 * u, C.text3, 'right');
  ctx.restore();
}
