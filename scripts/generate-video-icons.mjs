// Export the actual Phosphor package icons for canvas preview and video export.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Wallet, Brain, Microphone, Crosshair, Code, ArrowUpRight, ArrowDownRight, ChartLineUp, Check } from '@phosphor-icons/react/ssr';
import { mkdir, writeFile } from 'node:fs/promises';
import { DARK_THEME, LIGHT_THEME } from '../src/lib/design-system.ts';
const icons = { big: Wallet, smart_trader: Brain, kol: Microphone, sniper: Crosshair, dev: Code, up: ArrowUpRight, down: ArrowDownRight, chart: ChartLineUp, check: Check };
for (const [mode, theme] of Object.entries({ light: LIGHT_THEME, dark: DARK_THEME })) {
await mkdir(`public/video-icons/${mode}`, { recursive: true });
for (const [name, Icon] of Object.entries(icons)) {
  await writeFile(`public/video-icons/${mode}/${name}.svg`, renderToStaticMarkup(createElement(Icon, { size: 64, color: theme.text, weight: 'regular' })));
}
}
