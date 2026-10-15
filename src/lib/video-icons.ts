import type { TagLayer } from './chart-tags';
import type { VideoTheme } from './frame-kit';

export type VideoIconName = TagLayer | 'up' | 'down' | 'chart' | 'check';
export type VideoIcons = Record<VideoTheme, Partial<Record<VideoIconName, CanvasImageSource>>>;
const NAMES: VideoIconName[] = ['big', 'smart_trader', 'kol', 'sniper', 'dev', 'up', 'down', 'chart', 'check'];

/** Local SVGs exported from @phosphor-icons/react; no emoji/font dependence. */
export async function loadVideoIcons(): Promise<VideoIcons> {
  const modes = await Promise.all((['light', 'dark'] as const).map(async mode => {
  const pairs = await Promise.all(NAMES.map(async (name) => {
    const image = new Image();
    image.src = `/video-icons/${mode}/${name}.svg`;
    await image.decode();
    return [name, image] as const;
  }));
  return [mode, Object.fromEntries(pairs)] as const;
  }));
  return Object.fromEntries(modes) as VideoIcons;
}
