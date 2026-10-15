import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_BACKGROUNDS, videoBackground } from '../src/lib/video-background';

function rgb(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(channels: number[]) {
  const linear = channels.map((value) => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
}

test('footer text remains readable over every solid and across each gradient in both video themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const preset of VIDEO_BACKGROUNDS) {
      const background = videoBackground(preset.id, theme);
      const start = rgb(background.colors[0]!);
      const end = rgb(background.colors.at(-1)!);
      const foreground = luminance(rgb(background.ink));
      for (let step = 0; step <= 20; step++) {
        const surface = luminance(start.map((value, index) => value + (end[index]! - value) * step / 20));
        const ratio = (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05);
        assert.ok(ratio >= 4.5, `${preset.id}/${theme}: footer contrast ${ratio.toFixed(2)} at ${step / 20}`);
      }
    }
  }
});

test('brand follows light/dark while a chosen background is preserved across theme changes', () => {
  assert.equal(videoBackground('brand', 'light').colors[0], '#AEFFE0');
  assert.equal(videoBackground('brand', 'dark').colors[0], '#003726');
  for (const preset of VIDEO_BACKGROUNDS.filter((item) => item.id !== 'brand')) {
    assert.deepEqual(videoBackground(preset.id, 'light').colors, videoBackground(preset.id, 'dark').colors);
  }
});

test('custom solids keep at least 4.5:1 footer contrast across the color gamut', () => {
  const samples = [...Array.from({ length: 16 }, (_, index) => index * 16), 255];
  for (const red of samples) for (const green of samples) for (const blue of samples) {
    const color = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    const background = videoBackground('custom', 'dark', color);
    assert.equal(background.colors[0], color);
    const surface = luminance([red, green, blue]);
    const foreground = luminance(rgb(background.ink));
    assert.ok((Math.max(surface, foreground) + .05) / (Math.min(surface, foreground) + .05) >= 4.5, color);
  }
  assert.equal(videoBackground('custom', 'light', 'invalid').colors[0], '#C8D8CC');
});
