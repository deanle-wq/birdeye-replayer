import { BRAND, BRAND_SCALE } from './design-system';
import type { VideoTheme } from './frame-kit';

// One palette drives the picker, canvas preview and exported video.
export const VIDEO_BACKGROUNDS = [
  { id: 'brand', label: 'Brand', kind: 'solid', colors: [BRAND_SCALE[950]], ink: BRAND_SCALE[100] },
  { id: 'sage', label: 'Sage', kind: 'solid', colors: ['#C8D8CC'], ink: '#10271D' },
  { id: 'sand', label: 'Sand', kind: 'solid', colors: ['#EEE8DC'], ink: '#10271D' },
  { id: 'slate', label: 'Slate', kind: 'solid', colors: ['#263746'], ink: '#F0F7F2' },
  { id: 'lilac', label: 'Lilac', kind: 'solid', colors: ['#D8D0E7'], ink: '#10271D' },
  { id: 'charcoal', label: 'Charcoal', kind: 'solid', colors: ['#242827'], ink: '#F0F7F2' },
  { id: 'mint-glow', label: 'Mint glow', kind: 'gradient', colors: ['#BFE8D7', '#E5EEE0'], ink: '#10271D' },
  { id: 'forest', label: 'Forest', kind: 'gradient', colors: ['#0A2B21', '#285447'], ink: '#F0F7F2' },
  { id: 'dusk', label: 'Dusk', kind: 'gradient', colors: ['#283B4E', '#63506F'], ink: '#F0F7F2' },
  { id: 'sunset', label: 'Sunset', kind: 'gradient', colors: ['#E8C5B4', '#D5CBE5'], ink: '#10271D' },
] as const;

export type VideoBackgroundId = (typeof VIDEO_BACKGROUNDS)[number]['id'] | 'custom';

/** Choose the higher-contrast ink for any solid the user picks. */
export function backgroundInk(hex: string): string {
  const linear = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#FFFFFF';
}

export function videoBackground(id: VideoBackgroundId = 'brand', theme: VideoTheme = 'dark', customColor = '#C8D8CC') {
  if (id === 'custom') {
    const color = /^#[0-9a-f]{6}$/i.test(customColor) ? customColor : '#C8D8CC';
    return { id, label: 'Custom', kind: 'solid' as const, colors: [color], ink: backgroundInk(color), swatch: color };
  }
  const preset = VIDEO_BACKGROUNDS.find((item) => item.id === id) ?? VIDEO_BACKGROUNDS[0];
  const colors: readonly string[] = preset.id === 'brand' && theme === 'light' ? [BRAND_SCALE[200]] : preset.colors;
  const ink = preset.id === 'brand' && theme === 'light' ? BRAND.ink : preset.ink;
  return { ...preset, colors, ink, swatch: colors.length === 1 ? colors[0] : `linear-gradient(135deg, ${colors.join(', ')})` };
}

export function paintVideoBackground(ctx: CanvasRenderingContext2D, width: number, height: number, id: VideoBackgroundId | undefined, theme: VideoTheme, customColor?: string) {
  const background = videoBackground(id, theme, customColor);
  if (background.colors.length === 1) ctx.fillStyle = background.colors[0];
  else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    background.colors.forEach((color, index) => gradient.addColorStop(index / (background.colors.length - 1), color));
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
  return background.ink;
}
