import assert from "node:assert/strict";
import test from "node:test";
import { cueSchedule, formatChange, milestoneStep, tagBursts, videoTimeline, visibleTagBars } from "../src/lib/chart-scene";
import { binTagEvents, dropRoundTrips, selectEvents, tagSummary, trackerEvents, type TagEvent } from "../src/lib/chart-tags";
import { autoTimeframe, clampRange, fromInputValue, moveEdge, panRange, presetRange, snapRange, targetCandles, timeframeAllowed, toInputValue } from "../src/lib/range";
import { ipfsPath, logoCandidates } from "../src/lib/token-logo";
import { demoCandles, demoTags } from "../src/server/demo-chart";
import { niceThreshold, trackerFrame, trackerWindows } from "../src/server/services/chart-tags";
import { chartResultMetrics } from "../src/lib/chart-result";

const DAY = 86_400;
const bounds = { from: 1_700_000_000, to: 1_700_000_000 + 120 * DAY };

test("the window never inverts, leaves its bounds, or shrinks below an hour", () => {
  assert.deepEqual(clampRange({ from: bounds.from - DAY, to: bounds.from + DAY }, bounds), { from: bounds.from, to: bounds.from + 2 * DAY });
  assert.deepEqual(panRange({ from: bounds.to - DAY, to: bounds.to }, 5 * DAY, bounds), { from: bounds.to - DAY, to: bounds.to });
  const pushed = moveEdge({ from: bounds.from, to: bounds.from + 2 * 3_600 }, "from", bounds.from + 5 * 3_600, bounds);
  assert.equal(pushed.to - pushed.from, 3_600);
  assert.deepEqual(moveEdge({ from: bounds.from, to: bounds.to }, "to", bounds.to + DAY, bounds), bounds);
});

test("presets: launch day, last 7 days, and the run from the low to the ATH", () => {
  assert.deepEqual(presetRange("launch", bounds, []), { from: bounds.from, to: bounds.from + DAY });
  assert.deepEqual(presetRange("7d", bounds, []), { from: bounds.to - 7 * DAY, to: bounds.to });
  const history = [5, 3, 1, 4, 9, 6].map((price, index) => ({ unixTime: bounds.from + index * DAY, h: price * 1.1, l: price * 0.9 }));
  const ath = presetRange("ath", bounds, history);
  assert.equal(ath.from, bounds.from + 2 * DAY);
  assert.equal(ath.to, bounds.from + 6 * DAY);
});

test("auto timeframe fits about 14 candles a second of clip", () => {
  assert.equal(targetCandles(15), 210);
  assert.equal(targetCandles(5), 120);
  assert.equal(targetCandles(300), 800);
  assert.equal(autoTimeframe({ from: 0, to: 7 * DAY }, targetCandles(15)), "1H");
  assert.equal(autoTimeframe({ from: 0, to: DAY }, targetCandles(15)), "15m");
  assert.equal(autoTimeframe({ from: 0, to: 7 * DAY }, 800), "15m");
  // Years of history drop to weekly candles rather than a thousand daily ones.
  assert.equal(autoTimeframe({ from: 0, to: 1_055 * DAY }, targetCandles(15)), "1W");
  assert.equal(timeframeAllowed({ from: 0, to: 3_600 }, "1D"), false);
  assert.deepEqual(snapRange({ from: 3_700, to: 7_100 }, "1H"), { from: 3_600, to: 7_200 });
});

test("UTC datetime inputs round-trip", () => {
  assert.equal(toInputValue(1_760_000_000), "2025-10-09T08:53");
  assert.equal(fromInputValue("2025-10-09T08:53"), 1_759_999_980);
  assert.equal(fromInputValue("nope"), null);
});

const event = (layer: TagEvent["layer"], side: TagEvent["side"], t: number, usd: number, wallet?: string): TagEvent => ({ layer, side, t, usd, wallet });

test("tracker buckets become one marker on the side of their net flow", () => {
  const events = trackerEvents("smart_trader", [
    { unix_time: 100, volume_buy_usd: 9_000, volume_sell_usd: 2_000, wallet_buy_count: 7, wallet_sell_count: 2 },
    { unix_time: 200, volume_buy_usd: 500, volume_sell_usd: 3_500, wallet_buy_count: 1, wallet_sell_count: 4 },
    { unix_time: 300, volume_buy_usd: 1_000, volume_sell_usd: 1_000 },
  ]);
  assert.deepEqual(events.map((item) => [item.side, item.usd, item.wallets]), [["buy", 7_000, 7], ["sell", 3_000, 4]]);
});

test("density keeps each layer's biggest events, in time order", () => {
  const events = [event("big", "buy", 3, 10), event("big", "sell", 1, 50), event("big", "buy", 2, 30), event("kol", "buy", 4, 1)];
  const kept = selectEvents(events, new Set(["big"]), "key");
  assert.deepEqual(kept.map((item) => item.t), [1, 2, 3]);
  const many = Array.from({ length: 20 }, (_, index) => event("smart_trader", "buy", index, index));
  assert.equal(selectEvents(many, new Set(["smart_trader"]), "key").length, 6);
  assert.equal(selectEvents(many, new Set(["smart_trader"]), "normal")[0]!.t, 6);
});

test("events land on the candle they fall in; outside ones are counted", () => {
  const candles = [{ unixTime: 0 }, { unixTime: 60 }, { unixTime: 120 }];
  const { bars, outside } = binTagEvents([event("big", "buy", 70, 5), event("big", "sell", 119, 9), event("big", "buy", -5, 1), event("big", "buy", 180, 1)], candles, 60);
  assert.deepEqual(bars.map((bar) => [bar.bar, bar.events.map((item) => item.usd)]), [[1, [9, 5]]]);
  assert.equal(outside, 2);
});

test("round trips by one wallet are dropped in pairs; one-way size stays", () => {
  const { kept, dropped } = dropRoundTrips([
    event("big", "buy", 1_000, 180_000, "bot"),
    event("big", "sell", 1_030, 176_000, "bot"),
    event("big", "buy", 1_100, 60_000, "whale"),
    event("big", "sell", 5_000, 59_000, "whale"),
    event("big", "sell", 1_040, 100_000, "bot"),
  ]);
  assert.equal(dropped, 2);
  assert.deepEqual(kept.map((item) => [item.wallet, item.side, item.usd]), [["whale", "buy", 60_000], ["whale", "sell", 59_000], ["bot", "sell", 100_000]]);
});

test("summary totals per layer and side", () => {
  const summary = tagSummary([event("smart_trader", "buy", 1, 10), event("smart_trader", "sell", 2, 4), event("smart_trader", "buy", 3, 6)]);
  assert.deepEqual(summary.get("smart_trader"), { buys: 2, sells: 1, buyUsd: 16, sellUsd: 4 });
});

test("revealed chart markers persist until their candle leaves the visible window", () => {
  const bars = new Map([[1, "first"], [3, "middle"], [5, "last"]]);
  assert.deepEqual(visibleTagBars(bars, 0, 4).map(([bar]) => bar), [1, 3]);
  assert.deepEqual(visibleTagBars(bars, 0, 6).map(([bar]) => bar), [1, 3, 5]);
  assert.deepEqual(visibleTagBars(bars, 3, 6).map(([bar]) => bar), [3, 5]);
});

test("bursts group close events; cues fire per burst side, per price step and in the outro", () => {
  const timeline = videoTimeline(15);
  const bursts = tagBursts([
    { bar: 10, events: [event("big", "buy", 1, 5)] },
    { bar: 11, events: [event("big", "sell", 2, 5)] },
    { bar: 80, events: [event("kol", "buy", 3, 5)] },
  ], 100, timeline.replaySeconds);
  assert.equal(bursts.length, 2);
  const cues = cueSchedule({ bursts, change: [{ t: 0, pct: 0 }, { t: 5, pct: 0.6 }, { t: 9, pct: 1.2 }], timeline, finalPct: 1.2, pack: "meme" });
  assert.equal(cues.filter((cue) => cue.cue === "buy").length, 2);
  assert.equal(cues.filter((cue) => cue.cue === "sell").length, 1);
  assert.ok(cues.filter((cue) => cue.cue === "bandos").length >= 2);
  assert.equal(cues.at(-1)!.cue, "win");
  assert.equal(milestoneStep(1.2), 0.25);
});

test("change reads as a percentage, and as a multiple past +1,000%", () => {
  assert.equal(formatChange(0.124), "+12.4%");
  assert.equal(formatChange(-0.5), "−50%");
  assert.equal(formatChange(2.5), "+250%");
  assert.equal(formatChange(15), "+16.0x");
});

test("result metrics use window OHLCV and convert price fields to market cap", () => {
  const candles = [
    { unixTime: 100, o: 2, h: 4, l: 1, c: 3, v: 10, v_usd: 25 },
    { unixTime: 200, o: 3, h: 5, l: 2, c: 4, v: 20, v_usd: 75 },
  ];
  assert.deepEqual(chartResultMetrics(candles, "price"), {
    axis: "price", open: 2, close: 4, high: 5, volumeUsd: 100, change: 1, from: 100, to: 200,
  });
  assert.deepEqual(chartResultMetrics(candles, "mcap", 1_000), {
    axis: "mcap", open: 2_000, close: 4_000, high: 5_000, volumeUsd: 100, change: 1, from: 100, to: 200,
  });
  assert.equal(chartResultMetrics(candles, "mcap")?.axis, "price");
});

test("tracker buckets: at least a candle wide, at most 300 a window, split by Birdeye's range limits", () => {
  assert.equal(trackerFrame(0, 7 * DAY, "15m").frame, "1h");
  assert.equal(trackerFrame(0, DAY, "5m").frame, "5m");
  assert.equal(trackerFrame(0, 400 * DAY, "1D").frame, "1W");
  assert.equal(trackerFrame(0, 200 * DAY, "4H").frame, "1D");
  assert.deepEqual(trackerWindows(0, 130 * DAY, 60 * DAY), [{ from: 0, to: 60 * DAY }, { from: 60 * DAY, to: 120 * DAY }, { from: 120 * DAY, to: 130 * DAY }]);
  // Two buckets short of the limit: 730 days of weekly buckets in three requests, none over 365 days.
  const weekly = trackerWindows(0, 730 * DAY, 365 * DAY, 7 * DAY);
  assert.equal(weekly.length, 3);
  assert.ok(weekly.every((window) => window.to - window.from < 365 * DAY));
  assert.equal(niceThreshold(200_000), 250_000);
  assert.equal(niceThreshold(3_000), 5_000);
  assert.equal(niceThreshold(10), 250);
});

test("IPFS logos race several gateways; other hosts go direct then through the proxy", () => {
  assert.equal(ipfsPath("ipfs://QmAbc/logo.png"), "QmAbc/logo.png");
  assert.equal(ipfsPath("https://ipfs.io/ipfs/QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g"), "QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g");
  const ipfs = logoCandidates("https://ipfs.io/ipfs/QmX");
  assert.ok(ipfs[0]!.startsWith("https://ipfs.filebase.io/ipfs/QmX"));
  assert.ok(ipfs.length >= 4);
  assert.deepEqual(logoCandidates("https://arweave.net/abc").length, 2);
  assert.deepEqual(logoCandidates("http://insecure.example/a.png"), []);
});

test("sample candles agree across timeframes, and sample tags stay inside the window", () => {
  const now = Math.floor(Date.now() / 1_000 / 3_600) * 3_600;
  const hourly = demoCandles(now - 2 * DAY, now, "1H");
  const fine = demoCandles(now - 2 * DAY, now, "15m");
  const hour = hourly[5]!;
  const inside = fine.filter((candle) => candle.unixTime >= hour.unixTime && candle.unixTime < hour.unixTime + 3_600);
  assert.equal(inside.length, 4);
  assert.ok(Math.abs(inside[0]!.o - hour.o) / hour.o < 1e-9);
  assert.ok(Math.abs(inside.at(-1)!.c - hour.c) / hour.c < 1e-9);
  const tags = demoTags(now - 7 * DAY, now, "1H", ["big", "smart_trader", "kol", "sniper", "dev"]);
  assert.ok(tags.events.length > 0);
  assert.ok(tags.events.every((item) => item.t >= now - 7 * DAY && item.t <= now + 3_600));
});
