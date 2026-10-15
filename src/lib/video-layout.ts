import { VIDEO_FORMATS, type Rect, type VideoShape } from './frame-kit';

/** Reserved regions keep chart, trade callout and result from overlapping. */
export function videoLayout(shape: VideoShape) {
  const { width: w, height: h } = VIDEO_FORMATS[shape];
  const u = Math.min(w, h) / 1080;
  const pad = 24 * u;
  const card: Rect = { x: pad, y: pad, w: w - pad * 2, h: h - pad - 88 * u };
  const inner = 40 * u;
  const header: Rect = { x: card.x + inner, y: card.y + inner, w: card.w - inner * 2, h: 112 * u };
  const bottom = card.y + card.h - 24 * u;
  const wide = w > h * 1.4;
  const summary: Rect = { x: header.x, y: bottom - 166 * u, w: header.w, h: 166 * u };
  const callout: Rect = { x: header.x, y: summary.y - 96 * u, w: header.w, h: 72 * u };
  const plot: Rect = { x: header.x, y: header.y + header.h + 48 * u, w: callout.w, h: callout.y - header.y - header.h - 76 * u };
  return { w, h, u, wide, card, header, plot, callout, summary, footerY: h - 34 * u };
}

export interface ResultCardLayout {
  card: Rect;
  inner: Rect;
  header: Rect;
  change: Rect;
  pills: Rect | null;
  divider: Rect;
  metrics: Rect;
  sparkline: Rect;
  footer: Rect;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Flex-like vertical layout for the outro card across every export ratio. */
export function resultCardLayout(container: Rect, shape: VideoShape, u: number, scale = 1, hasPills = true): ResultCardLayout {
  const wide = container.w > container.h * 1.35;
  const targetW = Math.min(container.w - 88 * u, (wide ? 1120 : 900) * u);
  const targetH = Math.min(container.h - 88 * u, (wide ? 790 : shape === 'portrait' ? 1180 : 980) * u);
  const card: Rect = {
    x: container.x + (container.w - targetW * scale) / 2,
    y: container.y + (container.h - targetH * scale) / 2,
    w: targetW * scale,
    h: targetH * scale,
  };
  const pad = clamp(card.w * .055, 34 * u, 52 * u);
  const inner: Rect = { x: card.x + pad, y: card.y + pad, w: card.w - pad * 2, h: card.h - pad * 2 };
  const headerH = clamp(card.h * .085, 64 * u, 86 * u);
  const changeH = clamp(card.h * .19, 140 * u, 190 * u);
  const pillsH = hasPills ? 38 * u : 0;
  const metricsH = clamp(card.h * .21, 168 * u, 210 * u);
  const sparklineH = clamp(card.h * .14, 104 * u, 150 * u);
  const footerH = 32 * u;
  const dividerH = u;
  const blockCount = hasPills ? 7 : 6;
  const fixed = headerH + changeH + pillsH + dividerH + metricsH + sparklineH + footerH;
  const gapCount = blockCount - 1;
  const gap = clamp((inner.h - fixed) / gapCount, 14 * u, 42 * u);
  const occupied = fixed + gap * gapCount;
  let y = inner.y + Math.max(0, (inner.h - occupied) / 2);

  const take = (height: number): Rect => {
    const rect = { x: inner.x, y, w: inner.w, h: height };
    y += height + gap;
    return rect;
  };

  const header = take(headerH);
  const change = take(changeH);
  const pills = hasPills ? take(pillsH) : null;
  const divider = take(dividerH);
  const metrics = take(metricsH);
  const sparkline = take(sparklineH);
  const footer = take(footerH);
  return { card, inner, header, change, pills, divider, metrics, sparkline, footer };
}
