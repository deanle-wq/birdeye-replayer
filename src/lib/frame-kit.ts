import { BRAND, BRAND_SCALE, DARK_THEME, LIGHT_THEME, FONT_FAMILY, hexRgb } from "./design-system";

/**
 * Drawing kit shared by every frame of a chart clip: formats, layout, the
 * semantic palette, tabular digits, token avatar and logo.
 */

export type VideoShape = "feed" | "landscape" | "portrait" | "square";

export const VIDEO_FORMATS: Record<VideoShape, { width: number; height: number; label: string }> = {
  feed: { width: 1080, height: 1350, label: "4:5" },
  landscape: { width: 1920, height: 1080, label: "16:9" },
  portrait: { width: 1080, height: 1920, label: "9:16" },
  square: { width: 1080, height: 1080, label: "1:1" },
};

export type VideoTheme = 'light' | 'dark';
export function videoColors(mode: VideoTheme) {
  const theme = mode === 'light' ? {
    ...LIGHT_THEME, canvas: '#F0F4EF', surface: '#F7FAF5', subtle: '#DFE9DF',
    text: '#10271D', secondary: '#354D40', tertiary: '#4B6052',
    borderSubtle: '#CDD8CD', border: '#A9BAAD', danger: '#AA362B',
  } : {
    ...DARK_THEME, canvas: '#0E1412', surface: '#141C18', subtle: '#202B25',
    borderSubtle: '#25352D', border: '#34483D',
  };
  const brand = mode === 'light' ? BRAND_SCALE[800] : BRAND_SCALE[300];
  return { ground: theme.canvas, surface: theme.surface, raised: theme.subtle,
    line: theme.borderSubtle, lineStrong: theme.border, text: theme.text,
    text2: theme.secondary, text3: theme.tertiary, brand, brandRgb: hexRgb(brand),
    loss: theme.danger, lossRgb: hexRgb(theme.danger), badgeText: mode === 'light' ? theme.inverse : BRAND.ink };
}
const C = videoColors('dark');

const FONT = FONT_FAMILY;
export const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT}`;
export interface Rect { x: number; y: number; w: number; h: number }

export function numberWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const digit = Math.max(...Array.from("0123456789", (char) => ctx.measureText(char).width));
  let width = 0;
  for (const char of text) width += /\d/.test(char) ? digit : ctx.measureText(char).width;
  return width;
}

export function drawNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = "left"): number {
  const digit = Math.max(...Array.from("0123456789", (char) => ctx.measureText(char).width));
  const width = numberWidth(ctx, text);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  const saved = ctx.textAlign;
  ctx.textAlign = "left";
  for (const char of text) {
    const advance = /\d/.test(char) ? digit : ctx.measureText(char).width;
    ctx.fillText(char, cursor + (/\d/.test(char) ? (digit - ctx.measureText(char).width) / 2 : 0), y);
    cursor += advance;
  }
  ctx.textAlign = saved;
  return width;
}


export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}


export function ground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, w, h);
}

/** Token artwork when supplied, with an explicit monogram fallback. */

export function drawTokenAvatar(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null | undefined, symbol: string, x: number, y: number, size: number, colors = C) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = colors.raised;
  ctx.fill();
  const width = image && "width" in image ? Number(image.width) : 0;
  const height = image && "height" in image ? Number(image.height) : 0;
  if (image && width > 0 && height > 0) {
    ctx.clip();
    // Cover-crop to the circle.
    const side = Math.min(width, height);
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = colors.brand;
    ctx.font = font(800, size * 0.44);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((symbol.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase(), cx, cy + size * 0.02);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = colors.lineStrong;
  ctx.lineWidth = 2;
  ctx.stroke();
}


/** Text shrunk to fit a width; returns the drawn width. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, weight: number, size: number, color: string): number {
  ctx.font = font(weight, size);
  const width = ctx.measureText(text).width;
  const fit = Math.min(1, Math.max(maxW, 1) / Math.max(width, 1));
  ctx.font = font(weight, size * fit);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return width * fit;
}


export function drawMessage(ctx: CanvasRenderingContext2D, message: string): void {
  const { width: w, height: h } = ctx.canvas;
  ground(ctx, w, h);
  ctx.fillStyle = C.text2;
  ctx.font = font(500, Math.min(w, h) * 0.034);
  ctx.textAlign = "center";
  ctx.fillText(message, w / 2, h / 2);
  ctx.textAlign = "left";
}


export function drawLogo(ctx: CanvasRenderingContext2D, logo: CanvasImageSource | null, x: number, y: number, height: number, align: "left" | "right" | "center") {
  if (logo && "width" in logo && Number(logo.width) > 0) {
    const ratio = Number(logo.width) / Number(logo.height || 1);
    const width = height * ratio;
    const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;
    ctx.drawImage(logo, left, y, width, height);
    return;
  }
  // Text fallback per the brand's logo ladder: horizontal → logomark → text.
  ctx.font = font(600, height * 0.62);
  ctx.fillStyle = C.text;
  ctx.textAlign = align;
  ctx.fillText("birdeye data", x, y + height * 0.72);
  ctx.textAlign = "left";
}
