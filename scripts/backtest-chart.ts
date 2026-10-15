/**
 * Backtest the chart feature against live Birdeye data, with the same services
 * the web app uses: npm run backtest:chart -- <MINT> [MINT…]
 *
 * For each token it loads the history, then replays several windows (launch
 * day, last 24h, 7D, 30D, full history, run to ATH) at the timeframe a 15 s
 * clip picks, with every tag layer and wallet names on, and checks the
 * candles and tags against the rules the app relies on.
 *
 * Reads BIRDEYE_API_KEY from the environment or .env.local. Spends compute
 * units: roughly 300–1,000 CU per window.
 */
import { existsSync, readFileSync } from "node:fs";
import { binTagEvents, TAG_LAYERS } from "../src/lib/chart-tags";
import { autoTimeframe, presetRange, snapRange, targetCandles, type RangePreset } from "../src/lib/range";
import { TIMEFRAME_SECONDS } from "../src/lib/replay-timeframe";
import { chartTags, trackerFrame } from "../src/server/services/chart-tags";
import { replayCandles } from "../src/server/services/replay-candles";
import { tokenChart } from "../src/server/services/token-chart";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}

const PRESETS: RangePreset[] = ["launch", "24h", "7d", "30d", "full", "ath"];
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

interface Check { name: string; ok: boolean; detail?: string }

async function backtestToken(mint: string) {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const lines: string[] = [];
  let cu = 0;
  const chart = await tokenChart(mint);
  cu += chart.usage?.cu ?? 0;
  check("history has candles", chart.history.length >= 2, `${chart.history.length} × ${chart.historyTimeframe}`);
  check("history is ordered", chart.history.every((candle, index, list) => index === 0 || list[index - 1]!.unixTime < candle.unixTime));

  for (const preset of PRESETS) {
    const range = presetRange(preset, chart.bounds, chart.history);
    const timeframe = autoTimeframe(range, targetCandles(15));
    const window = snapRange(range, timeframe);
    const started = Date.now();
    try {
      const candles = await replayCandles({ mint, from: window.from, to: window.to, timeframe });
      const ok = candles.length >= 2;
      check(`${preset}: candles`, ok, `${candles.length} × ${timeframe}`);
      if (!ok) continue;
      check(`${preset}: candles inside the window`, candles.every((candle) => candle.unixTime >= window.from && candle.unixTime <= window.to));
      const volumeUsd = candles.reduce((sum, candle) => sum + (candle.v_usd ?? candle.v * candle.c), 0);
      const tags = await chartTags({ mint, from: window.from, to: window.to, timeframe, layers: [...TAG_LAYERS], names: true, volumeUsd });
      cu += tags.usage.cu;
      const bucket = tags.trackerFrame ? trackerFrame(window.from, window.to, timeframe).seconds : TIMEFRAME_SECONDS[timeframe];
      check(`${preset}: tags inside the window`, tags.events.every((event) => event.t >= window.from - bucket && event.t <= window.to), `${tags.events.length} events`);
      check(`${preset}: tag values valid`, tags.events.every((event) => Number.isFinite(event.usd) && event.usd > 0 && (event.side === "buy" || event.side === "sell")));
      if (tags.bigThresholdUsd) {
        check(`${preset}: big trades at or above the size`, tags.events.filter((event) => event.layer === "big").every((event) => event.usd >= tags.bigThresholdUsd! * 0.999), `size ${usd(tags.bigThresholdUsd)}`);
      }
      if (tags.trackerFrame) {
        check(`${preset}: tracker bucket at least a candle wide`, bucket >= TIMEFRAME_SECONDS[timeframe], `${tags.trackerFrame} vs ${timeframe}`);
      }
      const { outside } = binTagEvents(tags.events, candles, TIMEFRAME_SECONDS[timeframe]);
      check(`${preset}: tags land on drawn candles`, outside <= Math.max(2, tags.events.length * 0.05), `${outside} of ${tags.events.length} outside`);
      check(`${preset}: CU per window under 1,000`, tags.usage.cu < 1_000, `${tags.usage.cu} CU`);
      const counts = TAG_LAYERS.map((layer) => `${layer} ${tags.events.filter((event) => event.layer === layer).length}`).join(" · ");
      const named = tags.events.filter((event) => event.names?.length).length;
      lines.push(`${preset.padEnd(6)} ${candles.length} × ${timeframe} · ${counts} · ${named} named · ${tags.trackerFrame ?? "no tracker"}${tags.bigThresholdUsd ? ` · big ≥ ${usd(tags.bigThresholdUsd)}` : ""} · ${tags.usage.cu} CU · ${((Date.now() - started) / 1_000).toFixed(1)}s${tags.notes.length ? `\n         notes: ${tags.notes.join(" | ")}` : ""}`);
    } catch (error) {
      check(`${preset}: replays without error`, false, error instanceof Error ? error.message.slice(0, 200) : String(error));
    }
  }
  return { mint, symbol: chart.token.symbol ?? mint.slice(0, 6), since: new Date(chart.bounds.from * 1_000).toISOString().slice(0, 10), lines, checks, cu };
}

async function main() {
  loadEnvFile(".env.local");
  if (!process.env.BIRDEYE_API_KEY) {
    console.error("BIRDEYE_API_KEY is missing. Add it to .env.local or the environment.");
    process.exit(1);
  }
  const mints = process.argv.slice(2);
  if (mints.length === 0) {
    console.error("Usage: npm run backtest:chart -- <MINT> [MINT…]");
    process.exit(1);
  }
  let failures = 0;
  let total = 0;
  for (const mint of mints) {
    try {
      const result = await backtestToken(mint);
      total += result.cu;
      const failed = result.checks.filter((item) => !item.ok);
      failures += failed.length;
      console.log(`\n## $${result.symbol} (${mint}) · trading since ${result.since}`);
      for (const line of result.lines) console.log(`  ${line}`);
      for (const item of result.checks) if (!item.ok || process.env.VERBOSE) console.log(`  ${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
      console.log(`  ${result.checks.length - failed.length}/${result.checks.length} checks passed · ${result.cu.toLocaleString()} CU`);
    } catch (error) {
      failures += 1;
      console.log(`\n## ${mint}\n  FAIL  token lookup threw — ${error instanceof Error ? error.message.slice(0, 200) : error}`);
    }
  }
  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} · ${total.toLocaleString()} CU in total`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
