import assert from "node:assert/strict";
import test from "node:test";
import { binEvents } from "../src/lib/replay-window";
import {
  activeLabels,
  bandosStep,
  burstValueAt,
  cueSchedule,
  fillBursts,
  formatPrice,
  LABEL_EXIT_SECONDS,
  milestoneStep,
  signedUsd,
  videoTimeline,
} from "../src/lib/video-scene";
import type { LedgerEvent } from "../src/server/pnl/ledger";

function fill(kind: "buy" | "sell", timestamp: number, valueUsd: number, signature = `${kind}-${timestamp}`): LedgerEvent {
  return { signature, timestamp, kind, quantity: 1, priceUsd: valueUsd, valueUsd, exactExecution: true };
}

// 101 one-minute bars over a 10s replay: bar n finishes at n × 0.1s.
const candles = Array.from({ length: 101 }, (_, index) => ({ unixTime: index * 60 }));

test("the result card always gets 2.5–4s, never more than 45% of a short clip", () => {
  assert.deepEqual(videoTimeline(15), { clipSeconds: 15, replaySeconds: 11.7, outroSeconds: 3.3 });
  assert.equal(videoTimeline(300).outroSeconds, 4);
  assert.equal(videoTimeline(5).outroSeconds, 2.25);
});

test("fills less than the gap apart share one popup; a long session is cut into fresh ones", () => {
  const events = [fill("buy", 600, 1), fill("buy", 660, 2), fill("sell", 720, 3), fill("buy", 3_000, 4)];
  const bins = binEvents(events, candles, "1m", { from: 0, to: 6_000 });
  const bursts = fillBursts(bins, candles.length, 10);
  assert.equal(bursts.length, 2);
  assert.deepEqual(bursts[0]!.bars.map((bar) => bar.bar), [10, 11, 12]);
  const dense = binEvents(Array.from({ length: 40 }, (_, index) => fill("buy", index * 60, 1)), candles, "1m");
  assert.ok(fillBursts(dense, candles.length, 10).every((burst) => burst.end - burst.start <= 1.6));
});

test("a popup's number climbs as its fills land instead of spoiling the total", () => {
  const events = [fill("buy", 600, 100), fill("buy", 660, 50), fill("sell", 720, 30)];
  const [burst] = fillBursts(binEvents(events, candles, "1m"), candles.length, 10);
  assert.deepEqual(burstValueAt(burst!, 1.0, (event) => event.valueUsd), { buy: 100, sell: 0, buys: 1, sells: 0 });
  assert.deepEqual(burstValueAt(burst!, 1.25, (event) => event.valueUsd), { buy: 150, sell: 30, buys: 2, sells: 1 });
});

test("a new burst pushes the old popup out, and never more than two are drawn", () => {
  const events = [fill("buy", 600, 1), fill("sell", 1_800, 1), fill("buy", 2_400, 1)];
  const bursts = fillBursts(binEvents(events, candles, "1m"), candles.length, 10);
  // A long hold, so the first popup is still up when the second arrives:
  // it leaves first, the newcomer enters as it clears, then stands alone.
  const leaving = activeLabels(bursts, 3.05, 3);
  assert.equal(leaving.length, 1);
  assert.equal(leaving[0]!.exit > 0, true, "the previous popup is leaving");
  const crossing = activeLabels(bursts, 3 + LABEL_EXIT_SECONDS * 0.9, 3);
  assert.equal(crossing.length, 2);
  assert.equal(crossing[1]!.exit, 0);
  assert.equal(activeLabels(bursts, 3 + LABEL_EXIT_SECONDS + 0.01, 3).length, 1);
  assert.equal(activeLabels(bursts, 0.5, 3).length, 0);
  assert.equal(activeLabels(bursts, 4 + 3 + LABEL_EXIT_SECONDS + 0.01, 3).length, 0);
  // A short hold lets a popup time out on its own before the next burst.
  assert.equal(activeLabels(bursts, 2.5, 1.1).length, 0);
});

test("sound: one cue per burst side, a handful of milestones, a counted result sting", () => {
  const events = [
    ...Array.from({ length: 6 }, (_, index) => fill("buy", 600 + index * 60, 1)),
    fill("sell", 900, 1),
  ];
  const bursts = fillBursts(binEvents(events, candles, "1m"), candles.length, 10);
  const timeline = videoTimeline(15);
  const pnl = Array.from({ length: 50 }, (_, index) => ({ t: index * 0.2, totalUsd: index * 2_000 }));
  const cues = cueSchedule({ bursts, pnl, timeline, finalTotalUsd: 98_000 });
  assert.equal(cues.filter((cue) => cue.cue === "buy").length, 1);
  assert.equal(cues.filter((cue) => cue.cue === "sell").length, 1);
  const milestones = cues.filter((cue) => cue.cue === "milestone").length;
  assert.ok(milestones >= 3 && milestones <= 5, `got ${milestones}`);
  assert.ok(cues.filter((cue) => cue.cue === "tick").length >= 4);
  assert.equal(cues.at(-1)?.cue, "win");
  assert.equal(cueSchedule({ bursts: [], pnl: [{ t: 0, totalUsd: -5 }], timeline, finalTotalUsd: -5 }).at(-1)?.cue, "loss");
  assert.equal(milestoneStep(98_000), 20_000);
  assert.equal(milestoneStep(1_200), 250);
});

test("sub-cent prices use subscript zeros; signs never rely on colour", () => {
  assert.equal(formatPrice(0.00001234), "$0.0₄1234");
  assert.equal(formatPrice(0.000099999), "$0.0₃1");
  assert.equal(formatPrice(0.0123), "$0.0123");
  assert.equal(formatPrice(1.5), "$1.50");
  assert.equal(signedUsd(-830), "−$830");
  assert.equal(signedUsd(184_520), "+$184.52K");
});

test("meme pack: a bandos call per $20K, widened for big winners, round steps below $20K", () => {
  const timeline = videoTimeline(15);
  const ramp = (peak: number) => Array.from({ length: 101 }, (_, index) => ({ t: index * 0.1, totalUsd: (peak * index) / 100 }));
  const calls = (peak: number) => cueSchedule({ bursts: [], pnl: ramp(peak), timeline, finalTotalUsd: peak, pack: "meme" });
  assert.deepEqual(calls(98_000).filter((cue) => cue.cue === "bandos").length, 4, "20K, 40K, 60K, 80K");
  assert.equal(bandosStep(98_000), 20_000);
  assert.equal(bandosStep(700_000), 120_000);
  assert.ok(calls(700_000).filter((cue) => cue.cue === "bandos").length <= 6);
  const small = calls(15_000);
  const smallCalls = small.filter((cue) => cue.cue === "bandos").length;
  assert.ok(smallCalls >= 3 && smallCalls <= 6, `small winners still hear bandos a few times, got ${smallCalls}`);
  assert.equal(small.filter((cue) => cue.cue === "milestone").length, 0);
  assert.equal(bandosStep(15_000), null);
  const clean = cueSchedule({ bursts: [], pnl: ramp(98_000), timeline, finalTotalUsd: 98_000, pack: "clean" });
  assert.equal(clean.filter((cue) => cue.cue === "bandos").length, 0);
});
