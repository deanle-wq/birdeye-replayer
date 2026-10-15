import { VIDEO_FORMATS, type Rect, type VideoShape } from './frame-kit';

/** Each region owns its space in both preview and exported frames. */
export function walletCardLayout(shape: VideoShape) {
  const { width: w, height: h } = VIDEO_FORMATS[shape];
  const u = Math.min(w, h) / 1080;
  const card: Rect = { x: 24 * u, y: 24 * u, w: w - 48 * u, h: h - 112 * u };
  const header: Rect = { x: card.x + 40 * u, y: card.y + 40 * u, w: card.w - 80 * u, h: 112 * u };
  const summary: Rect = { x: header.x, y: card.y + card.h - 236 * u, w: header.w, h: 212 * u };
  const callout: Rect = { x: header.x, y: summary.y - 96 * u, w: header.w, h: 72 * u };
  const plot: Rect = { x: header.x, y: header.y + header.h + 48 * u, w: header.w, h: callout.y - header.y - header.h - 76 * u };
  return { w, h, u, card, header, plot, callout, summary, footerY: h - 34 * u };
}

/** The outro shares the replay surface, with the chart ahead of supporting figures. */
export function walletResultLayout(shape: VideoShape) {
  const base = walletCardLayout(shape);
  const { u, card } = base;
  const x = card.x + 40 * u;
  const width = card.w - 80 * u;
  const columns = shape === 'landscape' || shape === 'square' ? 4 : 2;
  const heroSize = (shape === 'portrait' ? 144 : shape === 'square' ? 96 : shape === 'landscape' ? 128 : 112) * u;
  const statSize = (columns === 4 ? 38 : 46) * u;
  const rowHeight = 114 * u;
  const header: Rect = { x, y: card.y + 40 * u, w: width, h: 72 * u };
  const hero: Rect = { x, y: header.y + header.h + 40 * u, w: width, h: heroSize + 106 * u };
  const footer: Rect = { x, y: card.y + card.h - 76 * u, w: width, h: 36 * u };
  const stats: Rect = { x, y: footer.y - 32 * u - rowHeight * (4 / columns), w: width, h: rowHeight * (4 / columns) };
  const plot: Rect = { x, y: hero.y + hero.h + 74 * u, w: width, h: 0 };
  plot.h = stats.y - 40 * u - plot.y;
  return { ...base, header, hero, plot, stats, footer, columns, heroSize, statSize, rowHeight };
}
