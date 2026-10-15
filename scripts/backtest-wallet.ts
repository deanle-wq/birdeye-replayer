/**
 * Backtest wallet mode against live Birdeye data, with the same services the
 * web app uses: npm run backtest:wallet -- <WALLET> [WALLET…]
 *
 * For each wallet it loads the token list (and the next page when there is
 * one), checks the list's invariants, then opens up to three tokens the way
 * the Video button does (token context + wallet replay) and compares the
 * replay's Birdeye baseline with the wallet list's own numbers.
 *
 * Reads BIRDEYE_API_KEY from the environment or .env.local. Spends compute
 * units: roughly 300–2,000 CU per wallet depending on its activity.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mergeTokens, QUOTE_MINTS, type WalletTokenRow } from "../src/lib/wallet-portfolio";
import { tokenContext } from "../src/server/services/analyze-token";
import { walletPortfolio } from "../src/server/services/wallet-portfolio";
import { walletReplay } from "../src/server/services/wallet-replay";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomAddress(): string {
  let value = BigInt(`0x${randomBytes(32).toString("hex")}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)]! + out;
    value /= 58n;
  }
  return out;
}

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const finite = (token: WalletTokenRow) =>
  [token.investedUsd, token.soldUsd, token.realizedUsd, token.unrealizedUsd, token.totalUsd, token.holding, token.valueUsd, token.priceUsd]
    .every((value) => Number.isFinite(value));

interface Check { name: string; ok: boolean; detail?: string }

async function backtest(wallet: string) {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  let cu = 0;
  const started = Date.now();

  const first = await walletPortfolio(wallet, 0);
  cu += first.usage?.cu ?? 0;
  let tokens = first.tokens;
  check("no quote assets in the list", tokens.every((token) => !QUOTE_MINTS.has(token.mint)));
  check("one row per mint", new Set(tokens.map((token) => token.mint)).size === tokens.length);
  check("all numbers finite", tokens.every(finite));
  check("holding rows are worth ≥ $1", tokens.filter((token) => token.status === "holding").every((token) => token.valueUsd >= 1));
  check("held-only rows have no trades", tokens.filter((token) => token.status === "held").every((token) => token.buys + token.sells === 0));
  check("traded rows have trades", tokens.filter((token) => token.status !== "held").every((token) => token.buys + token.sells > 0));
  check("newest trade first", tokens.filter((token) => token.status !== "held").every((token, index, list) => index === 0 || (list[index - 1]!.lastTradeAt ?? 0) >= (token.lastTradeAt ?? 0)));

  let pages = 1;
  if (first.nextOffset !== null) {
    const second = await walletPortfolio(wallet, first.nextOffset);
    cu += second.usage?.cu ?? 0;
    pages += 1;
    const merged = mergeTokens(tokens, second.tokens);
    check("page 2 adds rows without duplicates", merged.length === new Set(merged.map((token) => token.mint)).size && merged.length >= tokens.length, `${tokens.length} → ${merged.length}`);
    tokens = merged;
  }

  // Open the cheapest traded tokens and the largest holding, like the Video button.
  const traded = tokens.filter((token) => token.status !== "held").sort((a, b) => a.buys + a.sells - (b.buys + b.sells));
  const picks = [...traded.slice(0, 2), ...tokens.filter((token) => token.status === "holding").sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 1)]
    .filter((token, index, list) => list.findIndex((other) => other.mint === token.mint) === index)
    .filter((token) => token.buys + token.sells <= 2_000);
  const replays: string[] = [];
  for (const token of picks) {
    try {
      const context = await tokenContext(token.mint);
      cu += context.usage?.cu ?? 0;
      check(`$${token.symbol}: chart has candles`, context.candles.length >= 2, `${context.candles.length} × ${context.candles[0]?.type ?? "?"}`);
      const replay = await walletReplay({ mint: token.mint, wallet, lastTradeAt: token.lastTradeAt });
      cu += replay.usage.cu;
      // Wallet PnL Details and Wallet PnL Multiple are both WAC: they should agree.
      const delta = Math.abs(replay.row.totalUsd - token.totalUsd);
      const tolerance = Math.max(5, Math.abs(token.totalUsd) * 0.05);
      const baselineTotal = replay.mode === "ledger" && replay.row.audit ? replay.row.audit.birdeyeTotalUsd : replay.row.totalUsd;
      const baselineDelta = Math.abs(baselineTotal - token.totalUsd);
      check(`$${token.symbol}: replay WAC baseline matches the list`, baselineDelta <= tolerance, `list ${usd(token.totalUsd)} · replay baseline ${usd(baselineTotal)}`);
      const fills = replay.mode === "ledger" ? (replay.row.audit?.ledger.buys ?? 0) + (replay.row.audit?.ledger.sells ?? 0) : replay.events.filter((event) => event.kind === "buy" || event.kind === "sell").length;
      replays.push(`$${token.symbol} ${replay.mode}${replay.row.audit ? `/${replay.row.audit.confidence}` : ""} · ${fills}/${token.buys + token.sells} fills · ${usd(replay.row.totalUsd)}${replay.mode === "ledger" ? ` (Δ ledger vs list ${usd(delta)})` : ""} · ${replay.usage.cu} CU · ${(replay.elapsedMs / 1_000).toFixed(1)}s`);
    } catch (error) {
      check(`$${token.symbol}: opens without error`, false, error instanceof Error ? error.message.slice(0, 160) : String(error));
    }
  }

  const sumTotal = tokens.reduce((total, token) => total + token.totalUsd, 0);
  return {
    wallet,
    label: first.identity?.label,
    tokens: tokens.length,
    pages,
    holding: tokens.filter((token) => token.status === "holding").length,
    held: tokens.filter((token) => token.status === "held").length,
    hidden: first.hiddenQuoteAssets,
    summaryTotal: first.summary.totalUsd,
    sumTotal,
    replays,
    checks,
    cu,
    seconds: (Date.now() - started) / 1_000,
  };
}

async function main() {
  loadEnvFile(".env.local");
  if (!process.env.BIRDEYE_API_KEY) {
    console.error("BIRDEYE_API_KEY is missing. Add it to .env.local or the environment.");
    process.exit(1);
  }
  const wallets = process.argv.slice(2);
  if (wallets.length === 0) {
    console.error("Usage: npm run backtest:wallet -- <WALLET> [WALLET…]   (add `empty` to test a never-used address)");
    process.exit(1);
  }
  let failures = 0;
  let totalCu = 0;
  for (const input of wallets) {
    const wallet = input === "empty" ? randomAddress() : input;
    try {
      const result = await backtest(wallet);
      totalCu += result.cu;
      const failed = result.checks.filter((item) => !item.ok);
      failures += failed.length;
      console.log(`\n## ${result.wallet}${result.label ? ` (${result.label})` : ""}${input === "empty" ? " (random, never used)" : ""}`);
      console.log(`tokens ${result.tokens} over ${result.pages} page(s) · ${result.holding} holding · ${result.held} held-only · ${result.hidden} quote assets hidden`);
      console.log(`Birdeye summary total ${usd(result.summaryTotal)} · sum of listed tokens ${usd(result.sumTotal)}`);
      for (const line of result.replays) console.log(`  replay  ${line}`);
      for (const item of result.checks) console.log(`  ${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
      console.log(`  ${result.cu.toLocaleString()} CU · ${result.seconds.toFixed(1)}s`);
    } catch (error) {
      failures += 1;
      console.log(`\n## ${wallet}\n  FAIL  wallet lookup threw — ${error instanceof Error ? error.message.slice(0, 200) : error}`);
    }
  }
  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} · ${totalCu.toLocaleString()} CU in total`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
