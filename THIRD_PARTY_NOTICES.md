# Third-party notices

## Meme sound pack

`public/sfx/kaching.mp3` and `public/sfx/bandos.m4a` (converted to AAC for
cross-browser decoding) are redistributed under this license:

```
MIT License

Copyright (c) 2026 Nathan Liow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The clips are meme audio; the license above covers their redistribution, not
necessarily rights in any underlying recording. Swap them for your own
recordings via `SAMPLE_URLS` in `src/lib/video-audio.ts` if needed.

## Phosphor video icons

`public/video-icons/*.svg` are exported from `@phosphor-icons/react`.
Regenerate with `node --import tsx scripts/generate-video-icons.mjs`.

```
MIT License

Copyright (c) 2020 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Glass & Air sound pack (approved Sound C)

Selected by the user on 13 October 2026. Used as embedded application/video
sound effects under the [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree).
Source category: [Mixkit Sci-Fi](https://mixkit.co/free-sound-effects/sci-fi/).
These files are part of the replay experience, not a standalone stock library.

| Local file | Original item | Source preview |
|---|---|---|
| `public/sfx/glass-sweep.mp3` | Fast sci fi transition sweep · item 3114 | https://assets.mixkit.co/active_storage/sfx/3114/3114-preview.mp3 |
| `public/sfx/glass-chime.mp3` | Crystal chime · item 3108 | https://assets.mixkit.co/active_storage/sfx/3108/3108-preview.mp3 |

The source files are unchanged. The player applies restrained gains (0.24 for
sweeps, 0.34 for the chime) before the shared master chain. Trade cues are at
least 1.5 seconds apart and leave space before the end chime. No voice, price
ticks or milestone tones play in this pack. Preview and export use the same
samples, cue schedule and gain settings.
