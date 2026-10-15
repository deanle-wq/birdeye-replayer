import assert from 'node:assert/strict';
import test from 'node:test';
import { cueSchedule, videoTimeline, type TagBurst } from '../src/lib/chart-scene';
import { cueAllowed, DEFAULT_SOUND } from '../src/lib/video-audio';

test('Glass & Air keeps the largest separated trades and leaves room for the final chime', () => {
  const timeline = videoTimeline(12);
  const burst: TagBurst = {
    start: 0, end: 9.2,
    bars: [[0, 100], [.2, 10_000], [.4, 200], [2, 500], [2.3, 100_000], [6, 30_000], [9.2, 1_000_000]].map(([time, usd], bar) => ({
      bar, time: time!, events: [{ layer: 'big', side: 'sell', t: time!, usd: usd! }],
    })),
  };
  const cues = cueSchedule({ bursts: [burst], change: [{ t: 1, pct: 10 }], timeline, finalPct: -.2, pack: 'glass' });
  const trades = cues.filter(cue => cue.cue === 'sell');
  assert.deepEqual(trades.map(cue => cue.t), [.2, 2.3, 6]);
  trades.forEach((cue, index) => {
    if (index) assert.ok(cue.t - trades[index - 1]!.t >= 1.5);
    assert.ok(cue.t + 1.208322 < timeline.replaySeconds);
  });
  assert.deepEqual(cues.at(-1), { t: timeline.replaySeconds + .12, cue: 'loss' });
  assert.ok(cues.at(-1)!.t + 2 <= timeline.clipSeconds);
  assert.ok(cues.every(cue => !['tick', 'milestone', 'bandos'].includes(cue.cue)));
});

test('Glass & Air defaults to sparse cues, respects mute and keeps legacy ticks and voice silent', () => {
  assert.equal(DEFAULT_SOUND.pack, 'glass');
  const settings = { ...DEFAULT_SOUND, milestones: true };
  for (const cue of ['tick', 'milestone', 'bandos'] as const) assert.equal(cueAllowed(cue, settings), false);
  assert.equal(cueAllowed('buy', settings), true);
  assert.equal(cueAllowed('win', settings), true);
  assert.equal(cueAllowed('sell', { ...settings, trades: false }), false);
  assert.equal(cueAllowed('loss', { ...settings, outro: false }), false);
  assert.equal(cueAllowed('win', { ...settings, enabled: false }), false);
});
